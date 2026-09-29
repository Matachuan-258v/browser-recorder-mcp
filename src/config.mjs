import {randomBytes} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';

const defaultEnvFile=fileURLToPath(new URL('../.env',import.meta.url));
async function readEnv(file){
  try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}
}

export async function loadConfig({env=process.env,envFile=env.MCP_ENV_FILE||defaultEnvFile}={}){
  const file=resolve(envFile);
  let content=await readEnv(file),values=parseEnv(content),generated=false;
  // An explicit nonempty environment token takes precedence over the file.
  if(!env.MCP_TOKEN&&!values.MCP_TOKEN){
    const lock=file+'.lock';
    const deadline=Date.now()+5000;
    for(;;){
      try{await mkdir(lock,{mode:0o700});break;}catch(error){
        if(error.code!=='EEXIST')throw error;
        if(Date.now()>=deadline)throw Error(`Timed out waiting for configuration lock: ${lock}`);
        await sleep(50);
      }
    }
    const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
    try{
      // Another starting process may already have persisted the shared token.
      content=await readEnv(file);values=parseEnv(content);
      if(!values.MCP_TOKEN){
        const token=randomBytes(32).toString('hex');
        const newline=content.includes('\r\n')?'\r\n':'\n';
        await writeFile(temporary,content+(content&&!content.endsWith('\n')?newline:'')+`MCP_TOKEN=${token}${newline}`,{mode:0o600,flag:'wx'});
        await rename(temporary,file);
        values.MCP_TOKEN=token;generated=true;
      }
    }finally{await rm(temporary,{force:true});await rm(lock,{recursive:true,force:true});}
  }
  for(const [key,value] of Object.entries(values)){
    if(env[key]===undefined||(key==='MCP_TOKEN'&&!env[key]))env[key]=value;
  }
  return {envFile:file,generated};
}
