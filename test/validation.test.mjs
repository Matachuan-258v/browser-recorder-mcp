import test from 'node:test';import assert from 'node:assert/strict';import {validateURL,validatePoint} from '../src/runtime.mjs';
test('navigation excludes local file and script URLs',()=>{
  assert.equal(validateURL('https://example.com'),'https://example.com/');
  for(const url of ['file:///etc/passwd','javascript:alert(1)','data:text/html,hello'])assert.throws(()=>validateURL(url));
});
test('click coordinates stay within the returned screenshot',()=>{
  validatePoint(0,0,1280,720);validatePoint(1279,719,1280,720);
  for(const p of [[-1,0],[1280,0],[0,720],[NaN,1]])assert.throws(()=>validatePoint(...p,1280,720));
});
