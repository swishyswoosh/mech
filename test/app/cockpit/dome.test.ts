import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observedDomeDegrees,formatDomeDegrees} from '../../../app/cockpit/domeReading.ts';
import {domeSliderPosition,domeSliderTarget} from '../../../app/cockpit/domeSlider.ts';
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

test('zero is the visual midpoint despite asymmetric dome limits',()=>{
 assert.equal(domeSliderPosition(-160),-100);assert.equal(domeSliderPosition(180),100);assert.equal(domeSliderPosition(0),0);
 assert.equal(domeSliderTarget(-100),-160);assert.equal(domeSliderTarget(100),180);
 for(const angle of [-160,-79,-1,0,1,79,180])assert.equal(domeSliderTarget(domeSliderPosition(angle),false),angle);
});
test('pointer snaps around center; keyboard can move one degree away without a snap trap',()=>{
 assert.equal(domeSliderTarget(-2),0);assert.equal(domeSliderTarget(2),0);
 assert.equal(domeSliderTarget(-8),0);assert.equal(domeSliderTarget(8),0);
 assert.equal(domeSliderTarget(-12),-19);assert.equal(domeSliderTarget(12),22);
 assert.equal(domeSliderTarget(.5,false),1);assert.equal(domeSliderTarget(-.5,false),-1);
 assert.equal(domeSliderTarget(110),180);assert.equal(domeSliderTarget(-110),-160);
 assert.equal(domeSliderTarget(NaN),undefined);
});
