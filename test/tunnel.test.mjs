import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {startTunnel} from '../src/tunnel.mjs';

function fixture(host='0.0.0.0'){
 const child=new EventEmitter();child.pid=12345;
 const calls=[],signals=[],errors=[];
 const tunnel=startTunnel({host,port:3456,platform:'linux',
  spawnProcess:(...args)=>{calls.push(args);return child;},
  kill:(pid,signal)=>{signals.push([pid,signal]);if(signal==='SIGTERM')child.emit('exit',0,null);},
  onFailure:error=>errors.push(error)
 });
 return {child,calls,signals,errors,tunnel};
}
test('hostc targets the actual listener, excludes MCP token and closes the process group',async()=>{
 const original=process.env.MCP_TOKEN;process.env.MCP_TOKEN='private-test-token';
 let f;
 try{f=fixture();}finally{if(original===undefined)delete process.env.MCP_TOKEN;else process.env.MCP_TOKEN=original;}
 assert.equal(f.calls[0][0],'npx');
 assert.deepEqual(f.calls[0][1],['--yes','hostc@latest','http://127.0.0.1:3456']);
 assert.equal(f.calls[0][2].env.MCP_TOKEN,undefined);
 assert.equal(f.calls[0][2].detached,true);
 await Promise.all([f.tunnel.close(),f.tunnel.close()]);
 assert.deepEqual(f.signals,[[-12345,'SIGTERM'],[-12345,'SIGKILL']]);
 assert.equal(f.errors.length,0);
});
test('hostc supports IPv6 listeners and reports unexpected exit or spawn failure',async()=>{
 const f=fixture('::');assert.equal(f.calls[0][1][2],'http://[::1]:3456');
 f.child.emit('exit',1,null);assert.match(f.errors[0].message,/exited unexpectedly/);
 await f.tunnel.close();
 const failed=fixture();failed.child.pid=undefined;
 failed.child.emit('error',Error('ENOENT'));assert.match(failed.errors[0].message,/Could not start hostc/);
 await failed.tunnel.close();
});
