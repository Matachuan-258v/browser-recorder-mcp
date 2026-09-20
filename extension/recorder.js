let recorder,stream,config,chain=Promise.resolve(),sequence=0,failed=null;
async function event(state,extra={}) {
  const res=await fetch(config.endpoint+'/event',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.token},body:JSON.stringify({id:config.id,state,...extra})});
  if(!res.ok)throw Error('Event upload failed: '+res.status);
}
async function start(message) {
  config=message.config;sequence=0;failed=null;chain=Promise.resolve();
  stream=await navigator.mediaDevices.getUserMedia({
    audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId}},
    video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId,maxWidth:config.width,maxHeight:config.height,maxFrameRate:config.fps}}
  });
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus'].find(x=>MediaRecorder.isTypeSupported(x));
  if(!mime)throw Error('No supported WebM audio/video codec');
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:config.bitrate});
  recorder.ondataavailable=({data})=>{
    if(!data.size)return;
    const seq=sequence++;
    chain=chain.then(async()=>{
      const res=await fetch(config.endpoint+'/chunk?id='+config.id+'&seq='+seq,{method:'POST',headers:{'Authorization':'Bearer '+config.token},body:data});
      if(!res.ok)throw Error('Chunk '+seq+' upload failed: '+res.status);
    }).catch(error=>{failed=String(error);});
  };
  recorder.onerror=e=>{failed=String(e.error);};
  recorder.onstop=async()=>{
    await chain;
    stream.getTracks().forEach(t=>t.stop());
    await event(failed?'error':'stopped',{chunks:sequence,error:failed});
  };
  recorder.start(1000);
  await event('recording',{mimeType:mime,tracks:stream.getTracks().map(t=>({kind:t.kind,settings:t.getSettings()}))});
}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message.to!=='recorder')return;
  if(message.op==='start'){
    start(message).then(()=>respond({ok:true})).catch(async e=>{
      stream?.getTracks().forEach(t=>t.stop());
      await event('error',{error:String(e)}).catch(()=>{});
      respond({error:String(e)});
    });
    return true;
  }
  if(message.op==='stop'){
    if(recorder?.state==='recording')recorder.stop();
    respond({ok:true});
  }
});
