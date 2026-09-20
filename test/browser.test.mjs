import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchOptions} from '../src/browser.mjs';
test('ordinary Chrome defaults have no container or GPU requirements',()=>{
 const opts=launchOptions({});
 assert.equal(opts.channel,'chrome');assert.equal(opts.pipe,true);assert.equal(opts.enableExtensions,true);
 assert.equal(opts.env,undefined);assert.equal(opts.userDataDir,undefined);
 assert.ok(!opts.args.some(a=>/sandbox|wayland|zink|webgl|alsa/.test(a)));
});
test('browser executable and environment-specific arguments are configurable',()=>{
 const opts=launchOptions({CHROME_PATH:'/custom/Chrome',CHROME_ARGS:'["--ozone-platform=wayland"]'});
 assert.equal(opts.executablePath,'/custom/Chrome');assert.equal(opts.channel,undefined);
 assert.ok(opts.args.includes('--ozone-platform=wayland'));
 assert.throws(()=>launchOptions({CHROME_ARGS:'{}'}),/JSON array/);
 assert.throws(()=>launchOptions({CHROME_ARGS:'[1]'}),/JSON array/);
 assert.throws(()=>launchOptions({CHROME_ARGS:'--flag'}),/JSON array/);
});
