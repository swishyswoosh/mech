import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observedDomeDegrees,formatDomeDegrees} from '../../../app/cockpit/domeReading.ts';
test('dome display uses fresh queried degrees, not the missing or raw streamed head angle',()=>{
 const snapshot:any={state:'ready',sensors:{values:{headAngle:999}},cockpitReadings:{'dome.degrees':{value:4.5,at:1000}}};
 assert.equal(observedDomeDegrees(snapshot,1200),4.5);
 assert.equal(observedDomeDegrees({...snapshot,sensors:undefined},1200),4.5);
 assert.equal(observedDomeDegrees(snapshot,16001),undefined);
 assert.equal(observedDomeDegrees({...snapshot,state:'disconnected'},1200),undefined);
 assert.equal(observedDomeDegrees({...snapshot,cockpitReadings:{}},1200),undefined);
 assert.equal(observedDomeDegrees({...snapshot,cockpitReadings:{'dome.degrees':{value:NaN,at:1000}}},1200),undefined);
});
test('both dome readouts use the same signed tenths and suppress negative zero',()=>{
 assert.equal(formatDomeDegrees(4.5),'+4.5°');
 assert.equal(formatDomeDegrees(-4.5),'−4.5°');
 assert.equal(formatDomeDegrees(-.01),'0.0°');
 assert.equal(formatDomeDegrees(undefined),'—');
});
