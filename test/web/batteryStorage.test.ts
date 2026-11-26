import test from 'node:test';
import assert from 'node:assert/strict';
import {browserBatteryProfilingStorage} from '../../web/batteryStorage.ts';
test('browser profile persistence rejects a stale whole-document replacement',async()=>{
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const first=browserBatteryProfilingStorage(storage),second=browserBatteryProfilingStorage(storage);
 await first.save('acknowledged',null);assert.equal(second.load(),'acknowledged');
 await assert.rejects(Promise.resolve().then(()=>second.save('stale',null)),/changed/i);
 assert.equal(first.load(),'acknowledged');
});
