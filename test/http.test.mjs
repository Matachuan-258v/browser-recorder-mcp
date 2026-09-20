import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startHttpServer} from '../src/http.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function runtime(){return {
 browser:null,closed:0,state:'idle',calls:0,
 recordStatus(){return {state:this.state};},
 async status(){this.calls++;this.browser={};return {url:'https://example.com'};},
 async close(){this.closed++;this.browser=null;}
};}
async function connect(url){
 const transport=new StreamableHTTPClientTransport(new URL(url));
 const client=new Client({name:'http-test',version:'1.0.0'});
 await client.connect(transport);return {client,transport};
}
const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(10);}throw Error('Timed out');}
test('HTTP MCP stays lazy, rejects a second session, executes tools and releases on DELETE',async()=>{
 const instances=[];
 const app=await startHttpServer({host:'127.0.0.1',port:0,createRuntime:()=>{const r=runtime();instances.push(r);return r;}});
 const base=`http://127.0.0.1:${app.port}`;
 let first,second;
 try{
  assert.equal((await (await fetch(base+'/health')).json()).browserStarted,false);
  assert.equal(instances.length,0);
  first=await connect(base+'/mcp');
  assert.equal((await first.client.listTools()).tools.length,7);
  assert.equal(instances[0].calls,0);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify(initialize)})).status,409);
  assert.equal((await fetch(base+'/mcp',{headers:{'mcp-session-id':'wrong',Accept:'text/event-stream'}})).status,404);
  assert.equal((await first.client.callTool({name:'browser_status',arguments:{}})).isError,undefined);
  assert.equal((await (await fetch(base+'/health')).json()).browserStarted,true);
  await first.transport.terminateSession();await first.client.close();
  assert.equal(instances[0].closed,1);
  second=await connect(base+'/mcp');
  assert.equal(instances.length,2);assert.equal(instances[1].calls,0);
 }finally{await first?.client.close();await second?.client.close();await app.close();}
 assert.equal(instances[1].closed,1);
});
test('malformed requests cannot occupy the session slot; simultaneous initialize only reserves one slot',async()=>{
 const app=await startHttpServer({host:'127.0.0.1',port:0,createRuntime:runtime});
 const url=`http://127.0.0.1:${app.port}/mcp`;
 try{
  assert.equal((await fetch(url,{method:'POST',headers,body:'{'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'tools/list',id:2})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(initialize)})).status,406);
  const responses=await Promise.all([1,2].map(()=>fetch(url,{method:'POST',headers,body:JSON.stringify(initialize)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 }finally{await app.close();}
});
test('idle expiry releases browser but protects recording and running tools',async()=>{
 const r=runtime();r.state='recording';
 const app=await startHttpServer({host:'127.0.0.1',port:0,idleMs:50,createRuntime:()=>r});
 const base=`http://127.0.0.1:${app.port}`;
 let connection;
 try{
  connection=await connect(base+'/mcp');
  await sleep(150);assert.equal(r.closed,0);
  r.status=async()=>{await sleep(150);return {ok:true};};
  const call=connection.client.callTool({name:'browser_status',arguments:{}});
  await sleep(20);r.state='idle';await sleep(80);assert.equal(r.closed,0);
  assert.equal((await call).isError,undefined);
  await until(()=>r.closed===1);
  assert.equal((await (await fetch(base+'/health')).json()).session,'idle');
 }finally{await connection?.client.close();await app.close();}
});

test('default entrypoint serves HTTP without Chrome installed and exits on SIGTERM',async()=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {fileURLToPath}=await import('node:url');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],{
  env:{...process.env,MCP_HOST:'127.0.0.1',MCP_PORT:'0',CHROME_PATH:'/nonexistent/chrome'}
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
  assert.equal((await (await fetch(base+'/health')).json()).browserStarted,false);
  connection=await connect(base+'/mcp');
  assert.equal((await connection.client.listTools()).tools.length,7);
  const state=await connection.client.callTool({name:'recording_status',arguments:{}});
  assert.equal(JSON.parse(state.content[0].text).state,'idle');
  assert.equal((await (await fetch(base+'/health')).json()).browserStarted,false);
  await connection.transport.terminateSession();
 }finally{
  await connection?.client.close();child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  const [code]=await exited;clearTimeout(timer);assert.equal(code,0);
 }
});
