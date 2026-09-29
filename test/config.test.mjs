import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../src/config.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'mcp-config-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return {dir,envFile:join(dir,'.env')};
}
test('generates a private token file and reuses the same token on restart',async t=>{
 const {envFile}=await fixture(t),env={};
 assert.equal((await loadConfig({env,envFile})).generated,true);
 assert.match(env.MCP_TOKEN,/^[a-f0-9]{64}$/);
 assert.equal(await readFile(envFile,'utf8'),`MCP_TOKEN=${env.MCP_TOKEN}\n`);
 if(process.platform!=='win32')assert.equal((await stat(envFile)).mode&0o777,0o600);
 const restarted={};assert.equal((await loadConfig({env:restarted,envFile})).generated,false);
 assert.equal(restarted.MCP_TOKEN,env.MCP_TOKEN);
});
test('loads dotenv values while explicit environment settings take precedence',async t=>{
 const {envFile}=await fixture(t);
 const original='# existing config\nMCP_TOKEN="'+ 'a'.repeat(64)+'"\nMCP_PORT=3456\nMCP_HOSTC=1\n';
 await writeFile(envFile,original);
 const env={MCP_TOKEN:'b'.repeat(64),MCP_PORT:'4567'};
 assert.equal((await loadConfig({env,envFile})).generated,false);
 assert.equal(env.MCP_TOKEN,'b'.repeat(64));assert.equal(env.MCP_PORT,'4567');assert.equal(env.MCP_HOSTC,'1');
 assert.equal(await readFile(envFile,'utf8'),original);
 const empty={MCP_TOKEN:''};await loadConfig({env:empty,envFile});assert.equal(empty.MCP_TOKEN,'a'.repeat(64));
});
test('appends a generated token without removing comments, empty values or other settings',async t=>{
 const {envFile}=await fixture(t);
 const original='# keep this\r\nMCP_TOKEN=\r\nMCP_PORT=3456';
 await writeFile(envFile,original);
 const env={};await loadConfig({env,envFile});
 assert.equal(await readFile(envFile,'utf8'),original+`\r\nMCP_TOKEN=${env.MCP_TOKEN}\r\n`);
 assert.equal(env.MCP_PORT,'3456');
 const restarted={};await loadConfig({env:restarted,envFile});assert.equal(restarted.MCP_TOKEN,env.MCP_TOKEN);
});
test('explicit token does not create a file; invalid nonempty tokens are not silently replaced',async t=>{
 const {dir,envFile}=await fixture(t),env={MCP_TOKEN:'short'};
 assert.equal((await loadConfig({env,envFile})).generated,false);
 assert.equal(env.MCP_TOKEN,'short');assert.deepEqual(await readdir(dir),[]);
});
test('simultaneous first starts share one persisted token',async t=>{
 const {dir,envFile}=await fixture(t),envs=Array.from({length:4},()=>({}));
 const results=await Promise.all(envs.map(env=>loadConfig({env,envFile})));
 assert.equal(results.filter(result=>result.generated).length,1);
 assert.equal(new Set(envs.map(env=>env.MCP_TOKEN)).size,1);
 assert.deepEqual(await readdir(dir),['.env']);
});
test('a token persistence failure aborts startup',async t=>{
 const {dir}=await fixture(t);
 await assert.rejects(loadConfig({env:{},envFile:join(dir,'missing','.env')}),{code:'ENOENT'});
});
