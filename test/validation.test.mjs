import test from 'node:test';import assert from 'node:assert/strict';import {validateURL} from '../src/runtime.mjs';
test('audio/video recording excludes local file and script URLs',()=>{
  assert.equal(validateURL('https://example.com'),'https://example.com/');
  for(const url of ['file:///etc/passwd','javascript:alert(1)','data:text/html,hello'])assert.throws(()=>validateURL(url));
});
