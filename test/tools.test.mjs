import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createToolServer,recordingConflict} from '../src/tools.mjs';
import {DevTools} from '../src/devtools.mjs';

const ok={content:[{type:'text',text:'ok'}]};
async function fixture(t){
 const calls=[],page=new EventEmitter();page.mainFrame=()=>page;
 const defs=['list_pages','navigate_page','close_page','take_screenshot','evaluate_script','screencast_start','screencast_stop','click_at'].map(name=>({name,description:'Upstream '+name,inputSchema:{type:'object',properties:{pageId:{type:'number'}}},annotations:{readOnlyHint:name==='list_pages'}}));
 const devtools={browser:null,async listTools(){return defs;},async pageForRecording(){return {page};},
  async callTool(params){calls.push(params);return ok;},async close(){calls.push('devtools.close');}};
 const runtime={devtools,record:null,recordStatus(){return this.record||{state:'idle'};},
  async startRecording(args){calls.push('recording.start');return this.record={id:'00000000-0000-4000-8000-000000000000',pageId:args.pageId,state:'recording'};},
  async stopRecording(){calls.push('recording.stop');this.record.state='finished';return this.record;},
  async close(){calls.push('recording.close');}};
 const app=createToolServer(runtime),client=new Client({name:'gateway-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await app.server.connect(b);await client.connect(a);
 t.after(async()=>{await app.close();await client.close();});
 const call=(name,args={})=>client.callTool({name,arguments:args});
 return {app,client,runtime,devtools,calls,defs,page,call};
}
test('merges the complete upstream catalog and preserves schemas, metadata and tool results',async t=>{
 const f=await fixture(t);const {tools}=await f.client.listTools();
 assert.equal(tools.length,f.defs.length+3);
 for(const def of f.defs)assert.deepEqual(tools.find(tool=>tool.name===def.name),def);
 assert.ok(!tools.some(tool=>tool.name.startsWith('browser_')));
 const response={content:[{type:'image',mimeType:'image/png',data:'aGVsbG8='},{type:'text',text:'original'}],structuredContent:{pageId:4},_meta:{source:'upstream'}};
 f.devtools.callTool=async params=>{f.calls.push(params);return response;};
 assert.deepEqual(await f.call('take_screenshot',{pageId:4}),response);
 assert.deepEqual(f.calls[0],{name:'take_screenshot',arguments:{pageId:4}});
 const failed={isError:true,content:[{type:'text',text:'upstream error'}]};f.devtools.callTool=async()=>failed;
 assert.deepEqual(await f.call('list_pages'),failed);
 await assert.rejects(f.call('browser_click'),/Unknown tool/);
});
test('local recording and silent screencasts are mutually exclusive; navigation is page-specific',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('recording_start',{})).isError,true);
 await f.call('recording_start',{pageId:4});
 for(const name of ['recording_start','screencast_start','navigate_page','close_page','evaluate_script'])assert.equal((await f.call(name,{pageId:4})).isError,true,name);
 assert.equal((await f.call('navigate_page',{pageId:5})).isError,undefined);
 assert.equal((await f.call('click_at',{pageId:4})).isError,undefined);
 await f.call('recording_stop',{recordingId:f.runtime.record.id});
 await f.call('screencast_start',{pageId:5});assert.equal(f.app.recordingActive,true);
 assert.equal((await f.call('recording_start',{pageId:4})).isError,true);
 assert.equal((await f.call('screencast_stop',{pageId:4})).isError,true);
 await f.call('screencast_stop',{pageId:5});assert.equal(f.app.recordingActive,false);
});
test('all tools share a queue and media is stopped before DevTools closes Chrome',async t=>{
 const f=await fixture(t);let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 f.devtools.callTool=async params=>{f.calls.push(params.name);if(params.name==='click_at'){entered();await new Promise(resolve=>{release=resolve;});}return ok;};
 const first=f.call('click_at',{pageId:1});await started;
 const second=f.call('screencast_start',{pageId:1});
 await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(f.calls,['click_at']);
 release();await Promise.all([first,second]);
 await f.app.close();
 assert.deepEqual(f.calls,['click_at','screencast_start','screencast_stop','recording.close','devtools.close']);
});
test('an externally closed screencast page is finalized via a surviving page',async t=>{
 const f=await fixture(t);
 f.devtools.callTool=async params=>{f.calls.push(params);return params.name==='list_pages'?{...ok,structuredContent:{pages:[{id:9}]}}:ok;};
 await f.call('screencast_start',{pageId:4});f.page.emit('close');
 await f.call('recording_status');
 assert.equal(f.app.recordingActive,false);
 assert.ok(f.calls.some(call=>call.name==='screencast_stop'&&call.arguments.pageId===9));
});
test('recording protects extension ownership, emulation, script and PWA mutation',()=>{
 for(const name of ['resize_page','emulate','evaluate_script','execute_webmcp_tool','install_pwa','performance_start_trace'])assert.ok(recordingConflict(name,{pageId:1},1));
 assert.equal(recordingConflict('performance_start_trace',{pageId:1,reload:false},1),undefined);
 assert.equal(recordingConflict('select_page',{pageId:2},1),undefined);
 assert.ok(recordingConflict('uninstall_extension',{id:'recorder'},undefined,'recorder'));
 assert.equal(recordingConflict('uninstall_extension',{id:'other'},undefined,'recorder'),undefined);
});
test('real DevTools MCP handshake exposes every public category without starting Chrome',async()=>{
 const devtools=new DevTools();
 try{
  const tools=await devtools.listTools(),names=tools.map(tool=>tool.name);
  assert.equal(names.length,58);
  for(const name of ['click_at','evaluate_script','screencast_start','install_extension','launch_pwa','execute_webmcp_tool','execute_3p_developer_tool','take_heapsnapshot','compare_heapsnapshots'])assert.ok(names.includes(name),name);
  assert.equal(devtools.browser,null);
 }finally{await devtools.close();}
});
