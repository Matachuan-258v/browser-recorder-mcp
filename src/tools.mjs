import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema,ListToolsRequestSchema,ErrorCode,McpError} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {GameBrowser} from './runtime.mjs';

const recordingSchemas={
  recording_start:z.object({
    pageId:z.number().int().nonnegative().describe('Page ID returned by DevTools list_pages. Requires the default browser context.'),
    fps:z.number().int().min(1).max(60).default(30),
    bitrate:z.number().int().min(500000).max(20000000).default(6000000),
    maxSeconds:z.number().int().min(1).max(600).default(300)
  }),
  recording_status:z.object({}),
  recording_stop:z.object({recordingId:z.string().uuid()})
};
const descriptions={
  recording_start:'Record a DevTools page with tab audio and video using tabCapture + MediaRecorder. Mutually exclusive with screencast_start. FPS is an upper bound.',
  recording_status:'Get audio/video recording state, page ID, chunk count, bytes and output files, plus the active silent screencast page if any. Does not launch Chrome.',
  recording_stop:'Stop audio/video recording, save all chunks, remux and validate audio/video streams.'
};
const localTools=Object.entries(recordingSchemas).map(([name,schema])=>({name,description:descriptions[name],inputSchema:z.toJSONSchema(schema)}));
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const failure=error=>({isError:true,content:[{type:'text',text:error.message}]});

export function recordingConflict(name,args,pageId,extensionId){
  if(extensionId&&['reload_extension','uninstall_extension','trigger_extension_action'].includes(name)&&args.id===extensionId)return 'The recorder extension is managed by recording_* tools.';
  if(pageId===undefined)return;
  if(['recording_start','screencast_start'].includes(name))return 'A recording is already active. Stop it before starting another.';
  if(['install_extension','reload_extension','uninstall_extension','trigger_extension_action'].includes(name))return 'Stop recording before changing extensions.';
  if(['install_pwa','launch_pwa','uninstall_pwa'].includes(name))return 'Stop recording before changing installed apps.';
  const samePage=args.pageId===undefined||args.pageId===pageId;
  if(!samePage)return;
  if(['navigate_page','close_page','resize_page','emulate','evaluate_script','execute_3p_developer_tool','execute_webmcp_tool'].includes(name)||
     name==='performance_start_trace'&&args.reload!==false||name==='lighthouse_audit'&&args.mode!=='snapshot'){
    return 'Stop recording before navigating, closing, resizing, emulating or executing scripts/tools on the recorded page.';
  }
}

export function createToolServer(runtime=new GameBrowser()){
  const devtools=runtime.devtools;
  const server=new Server({name:'game-browser',version:'0.1.0'},{capabilities:{tools:{}},
    instructions:'Browser tools are provided by Chrome DevTools MCP. Use list_pages pageId with recording_start for tab audio/video, or screencast_start for silent video. Stop recording before changing the recorded page.'});
  let queue=Promise.resolve(),closing=false,pending=0,closePromise,catalog;
  let screencast;
  let unwatchScreencast;
  function clearScreencast(){unwatchScreencast?.();unwatchScreencast=undefined;screencast=undefined;}
  devtools.onDisconnected=clearScreencast;
  function enqueue(fn){
    if(closing)return Promise.reject(Error('Session is closing.'));
    pending++;
    const job=queue.then(fn).finally(()=>{pending--;});queue=job.catch(()=>{});return job;
  }
  runtime.scheduleStop=()=>{
    if(closing)return;
    const id=runtime.recordStatus().id;
    enqueue(()=>runtime.stopRecording(id)).catch(error=>console.error('Recording stop:',error.message));
  };
  async function tools(){
    if(!catalog){
      const upstream=await devtools.listTools();
      if(upstream.some(tool=>Object.hasOwn(recordingSchemas,tool.name)))throw Error('DevTools tool name conflicts with a recording tool.');
      catalog=[...localTools,...upstream];
    }
    return catalog;
  }
  server.setRequestHandler(ListToolsRequestSchema,()=>enqueue(async()=>({tools:await tools()})));
  server.setRequestHandler(CallToolRequestSchema,(request,extra)=>enqueue(async()=>{
    const {name,arguments:args={}}=request.params;
    if(!(await tools()).some(tool=>tool.name===name))throw new McpError(ErrorCode.InvalidParams,`Unknown tool: ${name}`);
    try{
      extra.signal.throwIfAborted();
      const status=runtime.recordStatus();
      const pageId=screencast?.pageId??(['starting','recording','stopping','captured','finalizing'].includes(status.state)?status.pageId:undefined);
      const conflict=recordingConflict(name,args,pageId,runtime.extensionId);
      if(conflict)throw Error(conflict);
      if(Object.hasOwn(recordingSchemas,name)){
        const parsed=recordingSchemas[name].parse(args);
        if(name==='recording_start')return result(await runtime.startRecording(parsed));
        if(name==='recording_stop')return result(await runtime.stopRecording(parsed.recordingId));
        if(process.env.GAME_TEST_FIXTURES==='1')await runtime.prepare();
        return result({...runtime.recordStatus(),screencast:screencast??null});
      }
      if(name==='screencast_stop'&&screencast&&args.pageId!==screencast.pageId)throw Error('Stop screencast using the pageId that started it.');
      let screencastPage;
      if(name==='screencast_start')({page:screencastPage}=await devtools.pageForRecording(args.pageId,{requireDefaultContext:false}));
      const response=await devtools.callTool(request.params,{
        signal:extra.signal,
        onprogress:progress=>{
          const progressToken=request.params._meta?.progressToken;
          if(progressToken!==undefined)extra.sendNotification({method:'notifications/progress',params:{...progress,progressToken}}).catch(()=>{});
        }
      });
      if(!response.isError){
        if(name==='screencast_start'){
          screencast={pageId:args.pageId};
          const current=screencast;
          const stop=(pageLost=false)=>{enqueue(async()=>{
            if(screencast!==current)return;
            try{
              let pageId=current.pageId;
              if(pageLost){
                // Upstream stores one session-wide screencast, but validates
                // the pageId before its stop handler. Use a surviving page.
                const pages=await devtools.callTool({name:'list_pages',arguments:{}});
                pageId=pages.structuredContent?.pages?.[0]?.id;
                if(pageId===undefined)throw Error('No surviving page can finalize the screencast.');
              }
              const stopped=await devtools.callTool({name:'screencast_stop',arguments:{pageId}});
              if(stopped.isError)throw Error('DevTools could not finalize the interrupted screencast.');
            }catch(error){await devtools.close();throw error;}
            finally{clearScreencast();}
          }).catch(error=>console.error('Screencast interrupted:',error.message));};
          const lost=()=>stop(true);
          const navigate=frame=>{if(frame===screencastPage.mainFrame())stop();};
          screencastPage.on('close',lost);screencastPage.on('error',lost);screencastPage.on('framenavigated',navigate);
          unwatchScreencast=()=>{screencastPage.off('close',lost);screencastPage.off('error',lost);screencastPage.off('framenavigated',navigate);};
        }
        if(name==='screencast_stop')clearScreencast();
      }
      return response;
    }catch(error){return failure(error);}
  }).catch(error=>{if(error instanceof McpError)throw error;return failure(error);}));
  return {server,runtime,get pending(){return pending;},
    get browserStarted(){return Boolean(devtools.browser);},
    get recordingActive(){return Boolean(screencast)||['starting','recording','stopping','captured','finalizing'].includes(runtime.recordStatus().state);},
    close(){
      if(!closePromise){closing=true;closePromise=(async()=>{
        await queue;
        // Finish media while Chrome is alive, then ask DevTools to shut it down.
        try{
          if(screencast)await devtools.callTool({name:'screencast_stop',arguments:{pageId:screencast.pageId}}).catch(console.error);
          await runtime.close();
        }finally{clearScreencast();try{await devtools.close();}finally{await server.close();}}
      })();}
      return closePromise;
    }
  };
}
