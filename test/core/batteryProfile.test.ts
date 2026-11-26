import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBatteryProfile,estimateBatteryPercent,validBatteryProfile} from '../../core/batteryProfile.ts';
import type {BatteryCycle} from '../../core/batteryProfile.ts';

const minute=60000;
function cycle(id:string,offset=0,linear=false):BatteryCycle {
 const start=100000+Number(id)*2000000;
 return {id,deviceKey:'r2',startedAt:start,full:'confirmed',endedAt:start+30*minute,endpoint:'shutdown',
  samples:Array.from({length:31},(_,i)=>{const p=1-i/30;return {at:start+i*minute,volts:3.3+0.9*(linear?p:p*p)+offset,quiet:true};})};
}
test('nonlinear remaining-runtime curve requires complete cycles and a separate validation cycle',()=>{
 assert.match(buildBatteryProfile('r2',[]).issues.join(' '),/three|3/i);
 assert.equal(buildBatteryProfile('r2',[cycle('1'),cycle('2')]).profile,undefined);
 const result=buildBatteryProfile('r2',[cycle('1'),cycle('2',0.002),cycle('3',0.001)]);
 assert.deepEqual(result.issues,[]);const p=result.profile!;assert.ok(p);
 assert.equal(p.basis,'usable-runtime');assert.equal(p.deviceKey,'r2');
 assert.deepEqual(p.trainingCycleIds,['1','2']);assert.equal(p.validationCycleId,'3');
 assert.ok(Math.abs(estimateBatteryPercent(p,3.525)!-50)<=2);
 assert.ok(Math.abs(estimateBatteryPercent(p,3.444)!-40)<=2);
 assert.equal(estimateBatteryPercent(p,5),undefined);
 assert.equal(estimateBatteryPercent(p,NaN),undefined);
 assert.equal(validBatteryProfile(p),true);
 assert.equal(buildBatteryProfile('r2',[cycle('1'),cycle('2',0.002),cycle('3',0.001)]).profile?.id,p.id);
});
test('held-out disagreement blocks use even when two training cycles agree',()=>{
 const r=buildBatteryProfile('r2',[cycle('1'),cycle('2'),cycle('3',0,true)]);
 assert.equal(r.profile,undefined);assert.match(r.issues.join(' '),/validation|error/i);
});
test('incomplete, interrupted, sparse, flat and gapped cycles cannot calibrate a display',()=>{
 const invalids:BatteryCycle[]=[
  {...cycle('3'),endedAt:undefined,endpoint:undefined},
  {...cycle('3'),problem:'Charging observed during discharge'},
  {...cycle('3'),samples:cycle('3').samples.slice(0,10)},
  {...cycle('3'),samples:cycle('3').samples.map(s=>({...s,volts:4}))},
  {...cycle('3'),samples:cycle('3').samples.filter((_,i)=>i<10||i>15)},
  {...cycle('3'),samples:cycle('3').samples.map(s=>({...s,quiet:false}))},
  {...cycle('3'),samples:cycle('3').samples.slice(3)},
 ];
 for(const bad of invalids){const r=buildBatteryProfile('r2',[cycle('1'),cycle('2'),bad]);assert.equal(r.profile,undefined);assert.ok(r.issues.length);}
});
test('cycles from another droid or a different low-battery endpoint cannot be mixed',()=>{
 assert.equal(buildBatteryProfile('r2',[cycle('1'),cycle('2'),{...cycle('3'),deviceKey:'other'}]).profile,undefined);
 const r=buildBatteryProfile('r2',[cycle('1'),cycle('2'),{...cycle('3'),endpoint:'critical'}]);
 assert.equal(r.profile,undefined);assert.match(r.issues.join(' '),/endpoint/i);
});
test('profile validation rejects malformed curves and changed data produces a different candidate',()=>{
 const p=buildBatteryProfile('r2',[cycle('1'),cycle('2'),cycle('3')]).profile!;
 assert.equal(validBatteryProfile({...p,points:[{volts:4,percent:100},{volts:3,percent:0}]}),false);
 assert.equal(validBatteryProfile({...p,validation:{meanError:100,maxError:100}}),false);
 const next=buildBatteryProfile('r2',[cycle('1'),cycle('2'),cycle('3'),cycle('4')]).profile!;
 assert.notEqual(next.id,p.id);assert.deepEqual(next.trainingCycleIds,['1','2','3']);
});
