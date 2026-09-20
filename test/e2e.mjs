import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
if(!process.env.E2E_SERVER_URL){
 console.error('Run environments/wslc/test.ps1, or set E2E_SERVER_URL for an HTTP MCP service.');
 process.exit(2);
}
const url=new URL(process.env.E2E_SERVER_URL);
const health=await (await fetch(new URL('/health',url))).json();
assert.equal(health.browserStarted,false,'Test server must initially have no browser');
const transport=new StreamableHTTPClientTransport(url);
const dir=path.resolve('artifacts/e2e');await fs.mkdir(dir,{recursive:true});
const client=new Client({name:'game-browser-e2e',version:'1.0.0'});
async function call(name,args={}){console.error(name);const result=await client.callTool({name,arguments:args},undefined,{timeout:120000});assert.ok(!result.isError,JSON.stringify(result));return result;}
const data=r=>JSON.parse(r.content.find(c=>c.type==='text').text);
try{
 await client.connect(transport);
 const status=data(await call('browser_status'));
 await call('browser_open',{url:status.fixtureUrl});
 const shot=await call('browser_screenshot');const png=Buffer.from(shot.content.find(c=>c.type==='image').data,'base64');assert.equal(png.subarray(1,4).toString(),'PNG');await fs.writeFile(path.join(dir,'screenshot.png'),png);
 await call('browser_click',{x:90,y:50});
 const record=data(await call('recording_start',{maxSeconds:30}));
 await call('browser_click',{x:640,y:360,waitMs:1000});
 const rejected=await client.callTool({name:'browser_open',arguments:{url:status.fixtureUrl}});assert.equal(rejected.isError,true);
 await new Promise(r=>setTimeout(r,6000));
 const progress=data(await call('recording_status'));assert.ok(progress.bytes>0);
 const result=data(await call('recording_stop',{recordingId:record.id}));
 assert.equal(result.state,'finished');assert.ok(Number(result.probe.format.duration)>=5);
 assert.ok(result.probe.streams.some(s=>s.codec_type==='audio'));assert.ok(result.probe.streams.some(s=>s.codec_type==='video'&&s.width===1280&&s.height===720));
 assert.equal(data(await call('recording_stop',{recordingId:record.id})).state,'finished');
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));const automatic=data(await call('recording_start',{maxSeconds:2}));
 await new Promise(r=>setTimeout(r,4000));
 assert.equal(data(await call('recording_status')).state,'finished');
 assert.equal(data(await call('recording_stop',{recordingId:automatic.id})).state,'finished');
 console.log(JSON.stringify({passed:true,video:result.videoPath,duration:result.probe.format.duration}));
}finally{
 await transport.terminateSession().catch(()=>{});
 await client.close();
}
