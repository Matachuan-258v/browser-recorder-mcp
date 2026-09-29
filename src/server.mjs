import {startHttpServer} from './http.mjs';
import {startTunnel} from './tunnel.mjs';
import {loadConfig} from './config.mjs';

const config=await loadConfig();
if(config.generated)console.error(`Generated MCP_TOKEN and saved it to ${config.envFile}`);
const port=Number(process.env.MCP_PORT||3000);
const idleMs=Number(process.env.MCP_SESSION_IDLE_SECONDS||1800)*1000;
const host=process.env.MCP_HOST||'0.0.0.0';
if(!['0','1'].includes(process.env.MCP_HOSTC||'0'))throw Error('MCP_HOSTC must be 0 or 1');
const app=await startHttpServer({host,port,idleMs,token:process.env.MCP_TOKEN});
console.error(`MCP HTTP listening on port ${app.port}: /mcp, /health`);

let closing=false,tunnel;
function shutdown(code){
  if(closing)return;closing=true;
  Promise.all([tunnel?.close(),app.close()]).then(()=>process.exit(code),error=>{console.error(error);process.exit(1);});
}
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>shutdown(0));
if(process.env.MCP_HOSTC==='1'){
  try{
    tunnel=startTunnel({host,port:app.port,onFailure:error=>{console.error(error.message);shutdown(1);}});
  }catch(error){console.error(error.message);shutdown(1);}
}
