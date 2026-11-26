import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRamRecipe,ramRecipeAvailability} from '../../core/ramRecipe.ts';
import * as ram from '../../core/ramRecipe.ts';

// Removing bounds or changing module/endian encoding must fail these tests.
test('encodes the firmware asset55 audio record with a safe RAM slot header',()=>{
 const result=compileRamRecipe({slot:0,frames:[{atMs:0,records:[{type:'audio',sector:2970}]}]});
 assert.equal(Buffer.from(result.bytes).toString('hex'),'0000ff0000070b9a00fe');
 assert.equal(result.frames,1);assert.equal(result.durationMs,0);
 assert.equal(result.physicalExecutionVerified,false);
});
test('encodes recovered head, stance, heading, speed and LED module formats',()=>{
 const result=compileRamRecipe({slot:4,frames:[{atMs:0,records:[
  {type:'head',degrees:10,transitionMs:1000},
  {type:'stance',action:2},
  {type:'relative-heading',degrees:-90,transitionMs:1000},
  {type:'speed',speed:-127,transitionMs:1000},
  {type:'led-controls',values:[0,1,2,3,4,5,6,255],transitionMs:80},
 ]}]});
 assert.equal(Buffer.from(result.bytes).toString('hex'),'0004ff00000d020e3f00000003e80f00010203040506ff005011c2b4000003e8138103e8fe');
 assert.equal(result.durationMs,1000);
});
test('orders a copied frame snapshot without mutating caller records',()=>{
 const records=[{type:'head' as const,degrees:10,transitionMs:80},{type:'audio' as const,sector:2970}];
 const result=compileRamRecipe({slot:0,frames:[{atMs:0,records}]});
 records[0].degrees=60;assert.equal(result.bytes[5],7);assert.equal(records[0].type,'head');
});
test('rejects payloads capable of escaping recovered parser bounds',()=>{
 const frame={atMs:0,records:[{type:'audio' as const,sector:2970}]};
 for(const slot of [-1,5,256,NaN])assert.throws(()=>compileRamRecipe({slot,frames:[frame]}),/slot/i);
 assert.throws(()=>compileRamRecipe({slot:0,frames:[]}),/frame/i);
 assert.throws(()=>compileRamRecipe({slot:0,frames:Array.from({length:100},(_,atMs)=>({...frame,atMs}))}),/99/);
 assert.throws(()=>compileRamRecipe({slot:0,frames:Array.from({length:99},(_,atMs)=>({atMs,records:[{type:'led-controls',values:Array(8).fill(0),transitionMs:80}]}))}),/1000/);
 assert.throws(()=>compileRamRecipe({slot:0,frames:[{...frame,atMs:1}]}),/zero/i);
 assert.throws(()=>compileRamRecipe({slot:0,frames:[frame,frame]}),/increasing/i);
 assert.throws(()=>compileRamRecipe({slot:0,frames:[{atMs:0,records:[frame.records[0],frame.records[0]]}]}),/duplicate/i);
 assert.throws(()=>compileRamRecipe({slot:0,frames:[{atMs:0,records:[]}]}),/record/i);
 assert.throws(()=>compileRamRecipe({slot:0,frames:[frame,{atMs:65535,records:[{type:'head',degrees:0,transitionMs:1}]}]}),/65535/);
});
test('rejects unproven record semantics and invalid finite values',()=>{
 for(const record of [
  {type:'raw',bytes:[0xfe]}, {type:'audio',sector:65536},
  {type:'head',degrees:181,transitionMs:1},{type:'head',degrees:NaN,transitionMs:1},
  {type:'head',degrees:0,transitionMs:0},{type:'stance',action:4},
  {type:'speed',speed:-128,transitionMs:1},{type:'relative-heading',degrees:181,transitionMs:1},
  {type:'led-controls',values:Array(8).fill(0),transitionMs:79},
  {type:'led-controls',values:Array(7).fill(0),transitionMs:80},
  {type:'led-controls',values:Array(8).fill(256),transitionMs:80},
 ])assert.throws(()=>compileRamRecipe({slot:0,frames:[{atMs:0,records:[record as any]}]}));
});
test('stance does not extend the firmware schedule: reject a later unreachable stance frame',()=>{
 assert.throws(()=>compileRamRecipe({slot:0,frames:[
  {atMs:0,records:[{type:'stance',action:2}]},
  {atMs:100,records:[{type:'stance',action:0}]},
 ]}),/stance.*schedule/i);
});
test('wire format recovery never advertises a safe live upload path',()=>{
 assert.equal(ramRecipeAvailability.uploadEnabled,false);
 assert.equal(ramRecipeAvailability.executionEnabled,false);
 assert.match(ramRecipeAvailability.reason,/built-in/i);
 assert.match(ramRecipeAvailability.reason,/reset/i);
});
test('builds Nordic inline LED schedules without enabling the ST slot upload command',()=>{
 assert.equal(typeof ram.compileNordicInlineLedRecipe,'function');
 const result=ram.compileNordicInlineLedRecipe({frames:[
  {atMs:0,controls:[0,1,2,3,4,5,6,7],transitionMs:80},
  {atMs:1000,controls:[7,6,5,4,3,2,1,0],transitionMs:80},
 ]});
 assert.deepEqual([result.command.did,result.command.cid],[0x17,0x1a]);
 assert.equal(Buffer.from(result.command.data).toString('hex'),'0000ff00000f00010203040506070050ff03e80f07060504030201000050fe');
 assert.equal(result.durationMs,1080);
 assert.equal(result.firmware,'Nordic 7.0.101');
 assert.equal(result.physicalExecutionVerified,false);
 assert.deepEqual([result.cancelCommand.did,result.cancelCommand.cid],[0x17,0x1a]);
 assert.equal(Buffer.from(result.cancelCommand.data).toString('hex'),'0000ff0000fe');
 assert.equal(ramRecipeAvailability.uploadEnabled,false);
});
test('rejects unsupported semantics and malformed Nordic inline LED frames',()=>{
 assert.equal(typeof ram.compileNordicInlineLedRecipe,'function');
 for(const frames of [[],[{atMs:0,controls:[1],transitionMs:80}],[{atMs:0,controls:Array(8).fill(0),transitionMs:0}], [{atMs:0,records:[{type:'audio',sector:2970}]}], [{atMs:0,controls:Array(8).fill(0),transitionMs:80,records:[{type:'audio',sector:2970}]}]]){
  assert.throws(()=>ram.compileNordicInlineLedRecipe({frames:frames as any}));
 }
});
test('wire validation admits only bounded canonical Nordic LED schedules and its exact cancel frame',()=>{
 assert.equal(typeof ram.validateNordicInlineLedPayload,'function');
 const compiled=ram.compileNordicInlineLedRecipe({frames:[{atMs:0,controls:Array(8).fill(10),transitionMs:80}]});
 assert.deepEqual(ram.validateNordicInlineLedPayload(compiled.command.data),{kind:'schedule',durationMs:80});
 assert.deepEqual(ram.validateNordicInlineLedPayload(compiled.cancelCommand.data),{kind:'cancel',durationMs:0});
 for(const hex of ['','0000fe','0000ff0000070b9a00fe','0000ff0000fe00','0001ff00000f00010203040506070050fe','0000ff00000f00010203040506070000fe','0000ff00010f00010203040506070050fe']){
  assert.throws(()=>ram.validateNordicInlineLedPayload(Uint8Array.from(Buffer.from(hex,'hex'))));
 }
});
