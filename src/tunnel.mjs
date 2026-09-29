import {spawn} from 'node:child_process';

// Keep npx and its CLI child in one process group so stopping the server also
// releases the public URL. hostc itself handles transient disconnections.
export function startTunnel({host,port,onFailure,spawnProcess=spawn,platform=process.platform,kill=process.kill.bind(process)}){
  const targetHost=host==='0.0.0.0'?'127.0.0.1':host==='::'?'::1':host;
  if(!/^[a-zA-Z0-9.:-]+$/.test(targetHost))throw Error('Invalid MCP_HOST for hostc');
  const target=`http://${targetHost.includes(':')?`[${targetHost}]`:targetHost}:${port}`;
  const env={...process.env};
  delete env.MCP_TOKEN;
  const child=spawnProcess(platform==='win32'?'npx.cmd':'npx',['--yes','hostc@latest',target],{
    stdio:['ignore','inherit','inherit'],env,detached:platform!=='win32',shell:platform==='win32'
  });
  let stopping=false,finished=false,closePromise;
  let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  child.once('error',error=>{
    finished=true;resolveDone();
    if(!stopping)onFailure(Error(`Could not start hostc: ${error.message}`));
  });
  child.once('exit',(code,signal)=>{
    finished=true;resolveDone();
    if(!stopping)onFailure(Error(`hostc exited unexpectedly (${signal||code})`));
  });
  function signalTree(signal){
    if(!child.pid)return;
    if(platform==='win32'){
      const task=spawnProcess('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
      task.on('error',()=>child.kill(signal));
    }else{
      try{kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
    }
  }
  return {close(){
    if(!closePromise){
      stopping=true;
      closePromise=(async()=>{
        signalTree('SIGTERM');
        if(!finished){
          let timer;
          await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);
          clearTimeout(timer);
        }
        // Also remove a CLI descendant left behind if npx exited first.
        signalTree('SIGKILL');
        await done;
      })();
    }
    return closePromise;
  }};
}
