import {test} from 'node:test';
import assert from 'node:assert/strict';
import {devtoolsOptions} from '../src/devtools.mjs';
test('DevTools uses native resource disposal provided by Node 24+',async()=>{
 for(const name of ['DisposableStack','AsyncDisposableStack','SuppressedError']){
  assert.equal(typeof globalThis[name],'function',`${name} requires Node 24+`);
  assert.match(Function.prototype.toString.call(globalThis[name]),/\[native code\]/);
 }
 const released=[];
 const stack=new DisposableStack();
 stack.defer(()=>released.push('sync'));
 stack.dispose();
 const asyncStack=new AsyncDisposableStack();
 asyncStack.defer(async()=>released.push('async'));
 await asyncStack.disposeAsync();
 assert.deepEqual(released,['sync','async']);
});
test('DevTools owns an isolated Chrome with all public tool categories enabled',()=>{
 const opts=devtoolsOptions({});
 assert.equal(opts.channel,'stable');assert.equal(opts.isolated,true);assert.equal(opts.categoryExtensions,true);
 assert.equal(opts.categoryPwa,true);assert.equal(opts.categoryExperimentalWebmcp,true);
 assert.equal(opts.experimentalScreencast,true);assert.equal(opts.experimentalVision,true);assert.equal(opts.memoryDebugging,true);
 assert.equal(opts.browserUrl,undefined);assert.equal(opts.wsEndpoint,undefined);
 assert.ok(!opts.chromeArg.some(a=>/sandbox|wayland|zink|webgl|alsa/.test(a)));
});
test('browser executable and GPU arguments pass through to DevTools without overriding lifecycle',()=>{
 const opts=devtoolsOptions({CHROME_PATH:'/custom/Chrome',CHROME_ARGS:'["--ozone-platform=wayland"]'});
 assert.equal(opts.executablePath,'/custom/Chrome');assert.equal(opts.channel,undefined);
 assert.ok(opts.chromeArg.includes('--ozone-platform=wayland'));
 for(const value of ['{}','[1]','--flag'])assert.throws(()=>devtoolsOptions({CHROME_ARGS:value}),/JSON array/);
 for(const flag of ['--remote-debugging-port=9222','--user-data-dir=/tmp/profile'])assert.throws(()=>devtoolsOptions({CHROME_ARGS:JSON.stringify([flag])}),/DevTools manages/);
});
