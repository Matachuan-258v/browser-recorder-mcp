import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import {GameBrowser} from './runtime.mjs';
import {createToolServer} from './tools.mjs';

function json(res,status,value){
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
function error(res,status,message){json(res,status,{jsonrpc:'2.0',id:null,error:{code:-32000,message}});}
function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];let bytes=0,tooLarge=false;
    req.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>1024*1024){if(!tooLarge){tooLarge=true;reject(Object.assign(Error('Request body exceeds 1 MiB'),{status:413}));}return;}
      if(!tooLarge)chunks.push(chunk);
    });
    req.on('end',()=>{
      if(tooLarge)return;
      try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Object.assign(Error('Invalid JSON'),{status:400}));}
    });
    req.on('error',reject);
  });
}

export async function startHttpServer({host='0.0.0.0',port=3000,idleMs=1800000,createRuntime=()=>new GameBrowser()}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid MCP_PORT');
  if(!Number.isFinite(idleMs)||idleMs<=0)throw Error('MCP_SESSION_IDLE_SECONDS must be positive');
  let active=null,closing=false,closePromise;
  function dispose(session){
    if(session.cleanup)return session.cleanup;
    session.closing=true;clearTimeout(session.timer);
    session.cleanup=Promise.resolve().then(()=>session.app.close()).finally(()=>{if(active===session)active=null;});
    return session.cleanup;
  }
  function touch(session){
    clearTimeout(session.timer);
    if(session.closing)return;
    session.timer=setTimeout(()=>{
      const recording=session.app.runtime.recordStatus().state;
      if(session.app.pending||['starting','recording','stopping','captured','finalizing'].includes(recording)){touch(session);return;}
      dispose(session).catch(console.error);
    },idleMs);
    session.timer.unref();
  }
  async function route(req,res){
    const url=new URL(req.url,'http://localhost');
    if(closing){error(res,503,'Service is shutting down');return;}
    if(req.method==='GET'&&url.pathname==='/health'){
      json(res,200,{status:'ok',transport:'streamable-http',session:active?(active.closing?'closing':'active'):'idle',browserStarted:Boolean(active?.app.runtime.browser)});return;
    }
    if(url.pathname!=='/mcp'){error(res,404,'Not found');return;}
    if(!['GET','POST','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, DELETE');error(res,405,'Method not allowed');return;}
    let body;
    if(req.method==='POST'){
      if(!req.headers['content-type']?.toLowerCase().startsWith('application/json')){error(res,415,'Content-Type must be application/json');return;}
      body=await readBody(req);
    }
    const id=req.headers['mcp-session-id'];
    if(id){
      const session=active;
      if(!session||session.transport.sessionId!==id){error(res,404,'Session not found; initialize a new session');return;}
      if(session.closing){error(res,409,'Session is closing');return;}
      touch(session);
      await session.transport.handleRequest(req,res,body);
      return;
    }
    if(req.method!=='POST'||!isInitializeRequest(body)){error(res,400,'Initialize a session first');return;}
    if(active){error(res,409,'A browser session is already active. End it with DELETE /mcp or wait for the idle timeout.');return;}
    // Reserve the slot before any asynchronous work; two initializations cannot both win.
    const session={app:createToolServer(createRuntime()),closing:false};
    active=session;
    session.transport=new StreamableHTTPServerTransport({
      sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true,
      onsessionclosed:()=>dispose(session)
    });
    try{
      await session.app.server.connect(session.transport);
      const previous=session.transport.onclose;
      session.transport.onclose=()=>{previous?.();dispose(session).catch(console.error);};
      touch(session);
      await session.transport.handleRequest(req,res,body);
      if(!session.transport.sessionId)await dispose(session);
    }catch(e){await dispose(session);throw e;}
  }
  const server=http.createServer((req,res)=>{
    route(req,res).catch(e=>{
      if(!e.status)console.error('MCP HTTP:',e);
      if(!res.headersSent)error(res,e.status||500,e.status?e.message:'Internal server error');
      else res.destroy();
    });
  });
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {port:server.address().port,close(){
    if(!closePromise){closing=true;closePromise=(async()=>{
      const stopped=new Promise(resolve=>server.close(resolve));
      try{if(active)await dispose(active);}finally{server.closeAllConnections();await stopped;}
    })();}
    return closePromise;
  }};
}
