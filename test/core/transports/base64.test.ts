import test from 'node:test';
import assert from 'node:assert/strict';
import {toBase64,fromBase64} from '../../../core/transports/base64.ts';
test('bridge preserves every octet and BLE frame sizes across base64',()=>{
 for(const size of [0,1,2,3,7,18,20,21,31,256,1001]){
  const bytes=Uint8Array.from({length:size},(_,i)=>i%256);
  const expected=Buffer.from(bytes).toString('base64');
  assert.equal(toBase64(bytes),expected);
  assert.deepEqual(fromBase64(expected),bytes);
 }
});
