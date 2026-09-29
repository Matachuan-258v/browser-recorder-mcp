import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startHttpServer} from '../src/http.mjs';
const token='test-mcp-token-0123456789abcdef0123456789';
const authorization={Authorization:`Bearer ${token}`};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function runtime(){
 const r={
  browser:null,closed:0,state:'idle',calls:0,
  recordStatus(){return {state:this.state,pageId:1};},
  async status(){this.calls++;this.browser={};return {url:'https://example.com'};},
  async close(){this.closed++;this.browser=null;}
 };
 r.devtools={
  browser:null,
  async listTools(){return ['list_pages','navigate_page','take_screenshot','click_at'].map(name=>({name,inputSchema:{type:'object',properties:{}}}));},
  async callTool(){const value=await r.status();this.browser=r.browser;return {content:[{type:'text',text:JSON.stringify(value)}]};},
  async close(){this.browser=null;}
 };
 return r;
}
async function connect(url,requestHeaders=authorization){
 const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:requestHeaders}});
 const client=new Client({name:'http-test',version:'1.0.0'});
 await client.connect(transport);return {client,transport};
}
const headers={...authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
async function until(fn,attempts=100){for(let i=0;i<attempts;i++){if(await fn())return;await sleep(10);}throw Error('Timed out');}
test('missing or invalid token configuration fails before listening',async()=>{
 for(const token of [undefined,'','short',' '.repeat(32),'x'.repeat(32)+'\n']){
  await assert.rejects(startHttpServer({port:0,token}),/MCP_TOKEN/);
 }
});
test('authentication protects health, initialization, tool calls, SSE and session deletion',async()=>{
 const r=runtime();let created=0;
 const app=await startHttpServer({token,host:'127.0.0.1',port:0,createRuntime:()=>{created++;return r;}});
 const base=`http://127.0.0.1:${app.port}`;
 let connection;
 try{
  for(const value of [undefined,'Basic '+token,'Bearer wrong','Bearer '+token+'x']){
   const badHeaders=value?{Authorization:value}:{};
   for(const endpoint of ['/health','/mcp','/mcp?token='+token]){
    const response=await fetch(base+endpoint,{headers:badHeaders});
    assert.equal(response.status,401);
    assert.equal(response.headers.get('www-authenticate'),'Bearer realm="mcp"');
    assert.ok(!(await response.text()).includes(token));
   }
  }
  assert.equal((await fetch(base+'/mcp',{method:'POST',body:'{'})).status,401);
  assert.equal(created,0);
  connection=await connect(base+'/mcp');
  for(const method of ['GET','POST','DELETE']){
   const response=await fetch(base+'/mcp',{method,headers:{'mcp-session-id':connection.transport.sessionId},...(method==='POST'?{body:'{'}:{})});
   assert.equal(response.status,401);
  }
  assert.equal(r.closed,0);assert.equal(r.calls,0);
  assert.equal((await connection.client.listTools()).tools.length,7);
  assert.equal((await fetch(base+'/health',{headers:{Authorization:`bearer ${token}`}})).status,200);
  await connection.transport.terminateSession();assert.equal(r.closed,1);
  const initialized=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify(initialize)});
  assert.equal(initialized.status,200);await initialized.json();
  const stream=await fetch(base+'/mcp',{headers:{...authorization,'mcp-session-id':initialized.headers.get('mcp-session-id'),'mcp-protocol-version':'2025-11-25',Accept:'text/event-stream'}});
  assert.equal(stream.status,200);await stream.body.cancel();
 }finally{await connection?.client.close();await app.close();}
});
test('HTTP MCP stays lazy, rejects a second session, executes tools and releases on DELETE',async()=>{
 const instances=[];
 const app=await startHttpServer({token,host:'127.0.0.1',port:0,createRuntime:()=>{const r=runtime();instances.push(r);return r;}});
 const base=`http://127.0.0.1:${app.port}`;
 let first,second;
 try{
  assert.equal((await (await fetch(base+'/health',{headers:authorization})).json()).browserStarted,false);
  assert.equal(instances.length,0);
  first=await connect(base+'/mcp');
  assert.equal((await first.client.listTools()).tools.length,7);
  assert.equal(instances[0].calls,0);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify(initialize)})).status,409);
  assert.equal((await fetch(base+'/mcp',{headers:{...authorization,'mcp-session-id':'wrong',Accept:'text/event-stream'}})).status,404);
  assert.equal((await first.client.callTool({name:'list_pages',arguments:{}})).isError,undefined);
  assert.equal((await (await fetch(base+'/health',{headers:authorization})).json()).browserStarted,true);
  await first.transport.terminateSession();await first.client.close();
  assert.equal(instances[0].closed,1);
  second=await connect(base+'/mcp');
  assert.equal(instances.length,2);assert.equal(instances[1].calls,0);
 }finally{await first?.client.close();await second?.client.close();await app.close();}
 assert.equal(instances[1].closed,1);
});
test('malformed requests cannot occupy the session slot; simultaneous initialize only reserves one slot',async()=>{
 const app=await startHttpServer({token,host:'127.0.0.1',port:0,createRuntime:runtime});
 const url=`http://127.0.0.1:${app.port}/mcp`;
 try{
  assert.equal((await fetch(url,{method:'POST',headers,body:'{'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'tools/list',id:2})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{...authorization,'Content-Type':'application/json'},body:JSON.stringify(initialize)})).status,406);
  const responses=await Promise.all([1,2].map(()=>fetch(url,{method:'POST',headers,body:JSON.stringify(initialize)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 }finally{await app.close();}
});
test('idle expiry releases browser but protects recording and running tools',async()=>{
 const r=runtime();r.state='recording';
 const app=await startHttpServer({token,host:'127.0.0.1',port:0,idleMs:50,createRuntime:()=>r});
 const base=`http://127.0.0.1:${app.port}`;
 let connection;
 try{
  connection=await connect(base+'/mcp');
  await sleep(150);assert.equal(r.closed,0);
  r.status=async()=>{await sleep(150);return {ok:true};};
  const call=connection.client.callTool({name:'list_pages',arguments:{}});
  await sleep(20);r.state='idle';await sleep(80);assert.equal(r.closed,0);
  assert.equal((await call).isError,undefined);
  await until(()=>r.closed===1);
  assert.equal((await (await fetch(base+'/health',{headers:authorization})).json()).session,'idle');
 }finally{await connection?.client.close();await app.close();}
});

test('default entrypoint generates a token, serves authenticated HTTP and exits on SIGTERM',async()=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {fileURLToPath}=await import('node:url');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'mcp-entrypoint-'));
 const envFile=join(dir,'.env');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],{
  env:{...process.env,MCP_ENV_FILE:envFile,MCP_TOKEN:'',MCP_HOSTC:'0',MCP_HOST:'127.0.0.1',MCP_PORT:'0',CHROME_PATH:'/nonexistent/chrome'}
 });
 let connection;
 const exited=once(child,'exit');
 try{
  const port=await new Promise((resolve,reject)=>{
   let output='';const timeout=setTimeout(()=>reject(Error('Server did not become ready: '+output)),5000);
   child.stderr.on('data',chunk=>{output+=chunk;const m=/listening on port (\d+)/.exec(output);if(m){clearTimeout(timeout);resolve(Number(m[1]));}});
   child.once('error',e=>{clearTimeout(timeout);reject(e);});
   child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited before readiness: '+output));});
  });
  const base=`http://127.0.0.1:${port}`;
  const saved=await readFile(envFile,'utf8');
  const generated=/^MCP_TOKEN=([a-f0-9]{64})\n$/.exec(saved)?.[1];
  assert.ok(generated);
  const authorization={Authorization:`Bearer ${generated}`};
  assert.equal((await fetch(base+'/health')).status,401);
  assert.equal((await (await fetch(base+'/health',{headers:authorization})).json()).browserStarted,false);
  connection=await connect(base+'/mcp',authorization);
  const listed=(await connection.client.listTools()).tools.map(tool=>tool.name);
  assert.ok(listed.includes('take_screenshot'));assert.ok(listed.includes('recording_start'));
  assert.ok(!listed.includes('browser_status'));
  const state=await connection.client.callTool({name:'recording_status',arguments:{}});
  assert.equal(JSON.parse(state.content[0].text).state,'idle');
  assert.equal((await (await fetch(base+'/health',{headers:authorization})).json()).browserStarted,false);
  await connection.transport.terminateSession();
 }finally{
  await connection?.client.close();child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  const [code]=await exited;clearTimeout(timer);await rm(dir,{recursive:true,force:true});assert.equal(code,0);
 }
});

test('entrypoint supervises hostc startup, failure and shutdown',{skip:process.platform==='win32',timeout:15000},async t=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {fileURLToPath}=await import('node:url');
 const dir=await mkdtemp(join(tmpdir(),'mcp-hostc-test-'));
 try{
  // Substitute only the external CLI; exercise the real service and process group.
  await writeFile(join(dir,'npx'),`#!/usr/bin/env node
const fs=require('node:fs');
fs.writeFileSync(process.env.HOSTC_TEST_OUTPUT,JSON.stringify({args:process.argv.slice(2),pid:process.pid,hasToken:'MCP_TOKEN' in process.env}));
if(process.env.HOSTC_TEST_FAIL==='1')process.exit(2);
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},1000);
`,{mode:0o755});
  for(const fail of [false,true])await t.test(fail?'CLI failure stops MCP':'SIGTERM stops MCP and CLI',async()=>{
   const outputFile=join(dir,fail?'failure.json':'normal.json');
   const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],{
    env:{...process.env,PATH:dir+':'+process.env.PATH,MCP_TOKEN:token,MCP_HOST:'127.0.0.1',MCP_PORT:'0',MCP_HOSTC:'1',HOSTC_TEST_OUTPUT:outputFile,HOSTC_TEST_FAIL:fail?'1':'0'}
   });
   const exited=once(child,'exit');let output='',cli;
   child.stderr.on('data',chunk=>{output+=chunk;});
   try{
    await until(async()=>{try{cli=JSON.parse(await readFile(outputFile,'utf8'));return true;}catch{return false;}},500);
    const port=Number(/listening on port (\d+)/.exec(output)[1]);
    assert.deepEqual(cli.args,['--yes','hostc@latest',`http://127.0.0.1:${port}`]);
    assert.equal(cli.hasToken,false);
    if(!fail){
     assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,401);
     assert.equal((await fetch(`http://127.0.0.1:${port}/health`,{headers:authorization})).status,200);
     child.kill('SIGTERM');
    }
    const [code]=await exited;assert.equal(code,fail?1:0);
    assert.ok(!output.includes(token));
    await until(()=>{try{process.kill(cli.pid,0);return false;}catch(error){return error.code==='ESRCH';}});
   }finally{
    if(child.exitCode===null&&child.signalCode===null){
     child.kill('SIGTERM');
     const timer=setTimeout(()=>child.kill('SIGKILL'),6000);
     await exited;clearTimeout(timer);
    }
    if(cli)try{process.kill(-cli.pid,'SIGKILL');}catch{}
   }
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});
