import puppeteer from 'puppeteer-core';

// Browser selection is independent of the OS, display server and container runtime.
export function launchOptions(env=process.env){
  let args;
  try{args=JSON.parse(env.CHROME_ARGS||'[]');}catch{throw Error('CHROME_ARGS must be a JSON array of strings.');}
  if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('CHROME_ARGS must be a JSON array of strings.');
  return {
    ...(env.CHROME_PATH?{executablePath:env.CHROME_PATH}:{channel:'chrome'}),
    headless:false,pipe:true,enableExtensions:true,
    defaultViewport:{width:1280,height:720,deviceScaleFactor:1},
    // Without a userDataDir Puppeteer creates and cleans up an isolated temporary profile.
    args:['--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging',
      '--autoplay-policy=no-user-gesture-required','--window-size=1280,800',...args]
  };
}
export async function launchBrowser(){
  try{return await puppeteer.launch(launchOptions());}
  catch(error){throw new Error('Could not launch Chrome. Set CHROME_PATH to a Chrome/Chromium executable. '+error.message,{cause:error});}
}
