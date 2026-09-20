import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {GameBrowser} from './runtime.mjs';
export function createToolServer(runtime=new GameBrowser()){
const server=new McpServer({name:'game-browser',version:'0.1.0'});
let queue=Promise.resolve();
let closing=false,pending=0,closePromise;
function tool(name,description,inputSchema,fn){
  server.registerTool(name,{description,inputSchema},args=>{
    if(closing)return {isError:true,content:[{type:'text',text:'Session is closing.'}]};
    pending++;
    const job=queue.then(async()=>{
      try{
        const value=await fn(args);
        if(value.image){
          const {image,...meta}=value;
          return {content:[{type:'text',text:JSON.stringify(meta)},{type:'image',data:image,mimeType:'image/png'}]};
        }
        return {content:[{type:'text',text:JSON.stringify(value)}]};
      }catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
    });
    const tracked=job.finally(()=>{pending--;});
    queue=tracked.catch(()=>{});return tracked;
  });
}
tool('browser_open','Open an HTTP(S) game in the single controlled tab. Stop recording before navigating.',{url:z.string().url()},({url})=>runtime.open(url));
tool('browser_status','Get current URL, viewport, browser version and recording state.',{},()=>runtime.status());
tool('browser_screenshot','Return an image of the 1280x720 viewport. Coordinates are CSS pixels, origin top-left.',{},()=>runtime.screenshot());
tool('browser_click','Click viewport coordinates. Optionally wait and return the updated screenshot.',{
  x:z.number().min(0).max(1279),y:z.number().min(0).max(719),
  button:z.enum(['left','right','middle']).default('left'),
  clickCount:z.number().int().min(1).max(2).default(1),
  waitMs:z.number().int().min(0).max(5000).default(300),
  screenshot:z.boolean().default(true)
},args=>runtime.click(args));
tool('recording_start','Record this tab audio and video with tabCapture + MediaRecorder. Returns a recording ID. FPS is a requested upper bound.',{
  fps:z.number().int().min(1).max(60).default(30),
  bitrate:z.number().int().min(500000).max(20000000).default(6000000),
  maxSeconds:z.number().int().min(1).max(600).default(300)
},args=>runtime.startRecording(args));
tool('recording_status','Get recording state, chunk count, bytes and output file details.',{},()=>runtime.recordStatus());
tool('recording_stop','Stop recording, wait for all chunks, losslessly remux and validate audio/video streams.',{recordingId:z.string().uuid()},({recordingId})=>runtime.stopRecording(recordingId));
  return {server,runtime,get pending(){return pending;},close(){
    if(!closePromise){closing=true;closePromise=(async()=>{
      await queue;
      try{await runtime.close();}finally{await server.close();}
    })();}
    return closePromise;
  }};
}
