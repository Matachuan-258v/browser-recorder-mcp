import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import {McpServer} from 'chrome-devtools-mcp';
import {BrowserManager} from 'chrome-devtools-mcp/build/src/BrowserManager.js';
import {getCategoryOptions} from 'chrome-devtools-mcp/build/src/config/category-options.js';

// This adapter is the only dependency on DevTools' package-level integration API.
// Keep its version pinned and test the real MCP handshake when upgrading.
export function devtoolsOptions(env=process.env){
  let args;
  try{args=JSON.parse(env.CHROME_ARGS||'[]');}catch{throw Error('CHROME_ARGS must be a JSON array of strings.');}
  if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('CHROME_ARGS must be a JSON array of strings.');
  if(args.some(a=>/^--(?:remote-debugging|user-data-dir)/.test(a)))throw Error('DevTools manages the Chrome profile and debugging connection; remove these options from CHROME_ARGS.');
  return {
    ...Object.fromEntries(Object.keys(getCategoryOptions()).map(key=>[key,true])),
    memoryDebugging:true,
    pageIdRouting:true,experimentalVision:true,experimentalStructuredContent:true,javascriptEvaluation:true,
    experimentalScreencast:true,experimentalFfmpegPath:env.FFMPEG_PATH||'ffmpeg',
    usageStatistics:false,performanceCrux:false,sourceMaps:true,headless:false,isolated:true,
    ...(env.CHROME_PATH?{executablePath:env.CHROME_PATH}:{channel:'stable'}),
    viewport:{width:1280,height:720},
    filesystemRoot:[path.resolve(env.GAME_DATA_DIR||path.resolve(import.meta.dirname,'../artifacts/recordings'))],
    chromeArg:['--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required',
      '--force-device-scale-factor=1','--window-size=1280,800','--enable-features=WebMCP',...args]
  };
}

export class DevTools {
  constructor(options=devtoolsOptions()){
    this.options=options;this.manager=new BrowserManager(options);this.browser=null;
  }
  async init(){
    if(this.closed)throw Error('DevTools session is closed.');
    if(!this.ready)this.ready=(async()=>{
      this.upstream=await McpServer.from(this.options,{browserManager:{
        ensureBrowser:()=>this.ensureBrowser(),close:()=>this.manager.close()
      }});
      this.client=new Client({name:'browser-recorder-gateway',version:'0.1.0'});
      const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
      await this.upstream.connect(serverTransport);await this.client.connect(clientTransport);
    })();
    return this.ready;
  }
  async listTools(){
    await this.init();const tools=[];let cursor;
    do{const result=await this.client.listTools(cursor?{cursor}:{});tools.push(...result.tools);cursor=result.nextCursor;}while(cursor);
    return tools;
  }
  async ensureBrowser(){
    await this.init();
    const browser=await this.manager.ensureBrowser();
    if(browser!==this.browser){
      this.browser=browser;
      browser.once('disconnected',()=>{if(this.browser===browser){this.browser=null;this.onDisconnected?.();}});
    }
    return browser;
  }
  async callTool(params,options={}){
    await this.init();
    // Cancelling the MCP request does not necessarily stop Chrome's action.
    // Keep the gateway queue occupied until completion; a hard timeout closes
    // the owning DevTools session before any subsequent action can run.
    const {signal,...requestOptions}=options;
    signal?.throwIfAborted();
    try{return await this.client.callTool(params,undefined,{timeout:120000,...requestOptions});}
    catch(error){if(error.code===ErrorCode.RequestTimeout)await this.close();throw error;}
  }
  async pageForRecording(pageId,{requireDefaultContext=true}={}){
    // Resolve using the upstream pageId itself, not array order, URL or focus.
    // A temporary marker also disambiguates multiple tabs with identical URLs.
    const key='__mcp_recording_'+randomUUID().replaceAll('-','');
    const result=await this.callTool({name:'evaluate_script',arguments:{pageId,
      function:`() => { Object.defineProperty(globalThis, ${JSON.stringify(key)}, {value:true, configurable:true}); return true; }`,waitForStableDom:false}});
    if(result.isError)throw Error(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
    const browser=this.browser;
    let selected;
    for(const page of await browser.pages()){
      const found=await page.evaluate(key=>{
        const found=globalThis[key]===true;delete globalThis[key];return found;
      },key).catch(()=>false);
      if(found)selected=page;
    }
    if(!selected)throw Error('Recording page disappeared or navigated; call list_pages and retry.');
    if(requireDefaultContext&&selected.browserContext()!==browser.defaultBrowserContext())throw Error('Audio/video recording requires a page in the default browser context.');
    return {browser,page:selected};
  }
  async close(){
    if(this.closed)return;this.closed=true;
    try{await this.ready;}catch{}
    try{if(this.upstream)await this.upstream.close();else await this.manager.close();}
    finally{await this.client?.close();this.browser=null;}
  }
}
