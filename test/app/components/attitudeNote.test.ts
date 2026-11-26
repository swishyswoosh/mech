import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attitudeNote} from '../../../app/components/attitudeNote.ts';
const sensor={status:'streaming',sampleAt:1000,values:{'attitude.pitch':1.24,'attitude.roll':-0.44,'attitude.yaw':87},intervalMs:100,invalid:0,schemaEpoch:1};
test('tiny attitude note formats actual finite samples and normalizes negative zero',()=>{
 assert.equal(attitudeNote(sensor,true,1100),'pitch 1.2° · roll −0.4° · yaw 87.0°');
 assert.match(attitudeNote({...sensor,values:{...sensor.values,'attitude.roll':-0.001}},true,1100)!,/roll 0.0°/);
});
test('offline, absent, stale, partial and invalid samples never masquerade as live numbers',()=>{
 for(const s of [undefined,{...sensor,status:'stale'},{...sensor,sampleAt:1},{...sensor,values:{}},{...sensor,values:{...sensor.values,'attitude.yaw':NaN}}])assert.equal(attitudeNote(s,true,1100),null);
 assert.equal(attitudeNote(sensor,false,1100),null);
});
