chrome.action.onClicked.addListener(async tab => {
  const {config}=await chrome.storage.local.get('config');
  if(!config)return;
  try {
    if(await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({url:'recorder.html',reasons:['USER_MEDIA'],justification:'Record game tab audio and video in one stream'});
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const reply=await chrome.runtime.sendMessage({to:'recorder',op:'start',streamId,config});
    if(reply?.error)throw Error(reply.error);
  } catch(e) {
    await fetch(config.endpoint+'/event',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.token},body:JSON.stringify({id:config.id,state:'error',error:String(e)})});
  }
});
