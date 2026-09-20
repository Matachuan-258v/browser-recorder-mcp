import {startHttpServer} from './http.mjs';

const port=Number(process.env.MCP_PORT||3000);
const idleMs=Number(process.env.MCP_SESSION_IDLE_SECONDS||1800)*1000;
const app=await startHttpServer({host:process.env.MCP_HOST||'0.0.0.0',port,idleMs});
console.error(`MCP HTTP listening on port ${app.port}: /mcp, /health`);

let closing=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  if(closing)return;closing=true;
  app.close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
});
