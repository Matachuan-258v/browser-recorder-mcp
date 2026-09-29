import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DevTools} from './devtools.mjs';
const exec=promisify(execFile);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve(import.meta.dirname,'..');
export function validateURL(value) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw Error('Only http and https URLs are allowed.');
  return url.href;
}
export class GameBrowser {
  constructor(devtools=new DevTools()){
    this.devtools=devtools;
    this.dir=path.resolve(process.env.GAME_DATA_DIR||path.join(root,'artifacts','recordings'));this.width=1280;this.height=720;
    this.token=randomBytes(32).toString('hex');this.record=null;this.browser=null;this.http=null;
  }
  async prepare(){
    if(this.http)return;
    await fs.mkdir(this.dir,{recursive:true});
    this.http=http.createServer((req,res)=>this.receive(req,res).catch(error=>{res.statusCode=400;res.end(String(error));}));
    await new Promise((resolve,reject)=>{this.http.once('error',reject);this.http.listen(0,'127.0.0.1',resolve);});
    this.endpoint='http://127.0.0.1:'+this.http.address().port;
  }
  async init(pageId){
    await this.prepare();
    const {browser,page}=await this.devtools.pageForRecording(pageId);
    if(this.browser!==browser){
      this.browser=browser;
      browser.once('disconnected',()=>{
        if(this.browser!==browser)return;
        this.interrupt('Chrome disconnected; the recording cannot continue.');
        this.browser=null;this.extensionId=null;
      });
      this.extensionId=null;
    }
    if(!this.extensionId||!(await browser.extensions()).has(this.extensionId)){
      this.extensionId=await browser.installExtension(path.join(root,'extension'));
    }
    this.unwatchPage?.();this.page=page;
    const onClose=()=>this.interrupt('The recorded page was closed.');
    const onError=()=>this.interrupt('The recorded page crashed.');
    // Navigation from page JS or a click cannot be intercepted by tool routing.
    const onNavigate=frame=>{if(frame===page.mainFrame()&&this.isRecording())this.scheduleStop?.();};
    page.on('close',onClose);page.on('error',onError);page.on('framenavigated',onNavigate);
    this.unwatchPage=()=>{page.off('close',onClose);page.off('error',onError);page.off('framenavigated',onNavigate);};
  }
  isRecording(){return Boolean(this.record&&['starting','recording','stopping','captured','finalizing'].includes(this.record.state));}
  interrupt(message){
    if(!this.isRecording()||['captured','finalizing'].includes(this.record.state))return;
    clearTimeout(this.record.timer);this.record.state='error';this.record.error=message;
    // Preserve uploaded data and the failure reason, rather than reporting success.
    this.failureSave=fs.writeFile(path.join(this.dir,this.record.id+'.json'),JSON.stringify(this.recordStatus(),null,2)).catch(console.error);
    if(this.browser?.connected)this.interruptCleanup=this.worker().then(worker=>worker.evaluate(()=>chrome.runtime.sendMessage({to:'recorder',op:'stop'}))).catch(()=>{});
  }
  async worker(){
    const target=await this.browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().startsWith('chrome-extension://'+this.extensionId+'/'),{timeout:10000});
    return target.worker();
  }
  async receive(req,res){
    const url=new URL(req.url,'http://local');
    if(process.env.GAME_TEST_FIXTURES==='1'&&req.method==='GET'&&url.pathname==='/fixture'){
      res.setHeader('Content-Type','text/html');res.end(await fs.readFile(path.join(root,'fixtures/click-game.html')));return;
    }
    if(req.headers.authorization!=='Bearer '+this.token){res.statusCode=401;res.end('Unauthorized');return;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)throw Error('Upload too large');chunks.push(chunk);}
    const body=Buffer.concat(chunks);const r=this.record;
    if(req.method==='POST'&&url.pathname==='/chunk'){
      if(!r||url.searchParams.get('id')!==r.id||!['starting','recording','stopping'].includes(r.state))throw Error('No matching active recording');
      const seq=url.searchParams.get('seq');
      if(!/^\d+$/.test(seq)||Number(seq)!==r.nextSequence)throw Error('Unexpected chunk sequence');
      await fs.appendFile(r.rawPath,body);r.nextSequence++;r.bytes+=body.length;
    }else if(req.method==='POST'&&url.pathname==='/event'){
      const message=JSON.parse(body.toString());
      if(!r||message.id!==r.id)throw Error('No matching recording');
      if(message.state==='recording'){
        if(r.state!=='starting')throw Error('Unexpected recording start');
        r.state='recording';r.startedAt=new Date().toISOString();r.mimeType=message.mimeType;r.tracks=message.tracks;
      }else if(message.state==='stopped'){
        if(message.chunks!==r.nextSequence)throw Error('Chunk count mismatch');
        if(!['recording','stopping'].includes(r.state))throw Error('Unexpected recording stop');
        r.state='captured';
        this.scheduleStop?.();
      }else if(message.state==='error'){r.state='error';r.error=message.error||'Recorder failed';}
      else throw Error('Invalid recording event');
    }else{res.statusCode=404;res.end();return;}
    res.end('ok');
  }
  recordStatus(){
    if(!this.record)return {state:'idle',...(process.env.GAME_TEST_FIXTURES==='1'&&this.endpoint?{fixtureUrl:this.endpoint+'/fixture'}:{})};
    const {timer,...record}=this.record;return record;
  }
  async waitRecord(states,timeout=20000){
    const until=Date.now()+timeout;
    while(Date.now()<until){
      if(this.record.state==='error')throw Error(this.record.error);
      if(states.includes(this.record.state))return;
      await delay(100);
    }
    throw Error('Recorder timed out in state '+this.record.state);
  }
  async startRecording({pageId,fps=30,bitrate=6000000,maxSeconds=300}={}){
    if(this.record&&!['finished','error'].includes(this.record.state))throw Error('A recording is already active.');
    await this.interruptCleanup;await this.failureSave;
    await this.init(pageId);
    validateURL(this.page.url());
    try{
      await exec(process.env.FFMPEG_PATH||'ffmpeg',['-version'],{timeout:10000});
      await exec(process.env.FFPROBE_PATH||'ffprobe',['-version'],{timeout:10000});
    }catch(error){throw Error('Recording requires FFmpeg and ffprobe. Set FFMPEG_PATH / FFPROBE_PATH or add them to PATH. '+error.message);}
    const id=randomUUID();
    const dimensions=await this.page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    this.width=dimensions.width;this.height=dimensions.height;
    this.record={id,pageId,width:this.width,height:this.height,state:'starting',rawPath:path.join(this.dir,id+'.raw.webm'),nextSequence:0,bytes:0,fps,bitrate,maxSeconds};
    await fs.writeFile(this.record.rawPath,'',{flag:'wx'});
    let worker;
    try{
    worker=await this.worker();
    await worker.evaluate(config=>chrome.storage.local.set({config}),{
      id,endpoint:this.endpoint,token:this.token,width:this.width,height:this.height,fps,bitrate
    });
    await this.page.bringToFront();
      const extension=(await this.browser.extensions()).get(this.extensionId);
      await extension.triggerAction(this.page);
      await this.waitRecord(['recording']);
      this.record.timer=setTimeout(()=>this.scheduleStop?.(),maxSeconds*1000);
      return this.recordStatus();
    }catch(e){
      this.record.state='error';this.record.error=String(e);
      try{await worker.evaluate(()=>chrome.runtime.sendMessage({to:'recorder',op:'stop'}));}catch{}
      throw Error('Recording could not start: '+e.message);
    }
  }
  async stopRecording(id){
    if(!this.record||id!==this.record.id)throw Error('Unknown recording ID.');
    if(this.record.state==='finished')return this.recordStatus();
    if(this.finalizing)return this.finalizing;
    this.finalizing=this.finishRecording().finally(()=>{this.finalizing=null;});
    return this.finalizing;
  }
  async finishRecording(){
    const r=this.record;clearTimeout(r.timer);delete r.timer;
    if(r.state==='error')throw Error(r.error);
    try{
      if(['recording','starting'].includes(r.state)){
        r.state='stopping';
        const worker=await this.worker();
        await worker.evaluate(()=>chrome.runtime.sendMessage({to:'recorder',op:'stop'}));
      }
      await this.waitRecord(['captured']);
      r.state='finalizing';r.videoPath=path.join(this.dir,r.id+'.webm');
      await exec(process.env.FFMPEG_PATH||'ffmpeg',['-nostdin','-v','error','-y','-i',r.rawPath,'-c','copy',r.videoPath],{timeout:60000});
      const probe=await exec(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_format','-show_streams','-of','json',r.videoPath],{timeout:30000,maxBuffer:2*1024*1024});
      r.probe=JSON.parse(probe.stdout);
      if(!r.probe.streams.some(s=>s.codec_type==='video')||!r.probe.streams.some(s=>s.codec_type==='audio'))throw Error('Recording is missing a video or audio stream.');
      r.state='finished';r.stoppedAt=new Date().toISOString();
      await fs.writeFile(path.join(this.dir,r.id+'.json'),JSON.stringify(this.recordStatus(),null,2));
      return this.recordStatus();
    }catch(e){r.state='error';r.error=String(e);throw e;}
  }
  async close(){
    if(this.isRecording()){
      try{await this.stopRecording(this.record.id);}catch(e){console.error('Recording shutdown:',e);}
    }
    clearTimeout(this.record?.timer);
    this.unwatchPage?.();
    await this.interruptCleanup;await this.failureSave;
    // Browser shutdown belongs exclusively to DevTools.
    this.browser=null;this.page=null;
    if(this.http){this.http.closeAllConnections();await new Promise(resolve=>this.http.close(resolve));this.http=null;}
  }
}
