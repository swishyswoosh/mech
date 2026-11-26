import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleDevices,mergeDevice} from '../../../android/src/devicePicker.ts';
const unnamed={id:'unnamed',name:null,rssi:-10};
const named={id:'speaker',name:'Speaker',rssi:-20};
const r2={id:'r2',name:'D2-AB12',rssi:-95};
const service={id:'service',name:null,rssi:-90,serviceUuids:['00010001-574f-4f20-5370-6865726f2121']};
test('hide unidentified unnamed advertisers and rank likely R2s ahead of stronger unrelated devices',()=>{
 assert.deepEqual(visibleDevices([unnamed,named,r2,service]).map(d=>d.id),['r2','service','speaker']);
 assert.deepEqual(visibleDevices([unnamed,named,r2,service],true).map(d=>d.id),['r2','service','speaker','unnamed']);
});
test('sparse repeated advertisements retain useful names and service evidence without duplicate rows',()=>{
 const first=mergeDevice([],r2);
 const updated=mergeDevice(first,{...unnamed,id:'r2',serviceUuids:service.serviceUuids});
 assert.equal(updated.length,1);assert.equal(updated[0].name,'D2-AB12');
 assert.deepEqual(mergeDevice(updated,{...unnamed,id:'r2'})[0].serviceUuids,service.serviceUuids);
});
test('signal jitter does not reorder the visible choices under a finger',()=>{
 const devices=[r2,{...r2,id:'other',name:'D2-ABCD',rssi:-20}];
 assert.deepEqual(visibleDevices(devices).map(d=>d.id),visibleDevices(devices.map(d=>({...d,rssi:-d.rssi}))).map(d=>d.id));
});
