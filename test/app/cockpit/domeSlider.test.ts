import {test} from 'node:test';import assert from 'node:assert/strict';
import {domeSliderPosition,domeSliderTarget} from '../../../app/cockpit/domeSlider.ts';
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
