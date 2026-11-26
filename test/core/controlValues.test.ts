import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedLightCommand,headingCommand,readFloatResponse} from '../../core/controlValues.ts';
test('selected LED channels preserve ascending mask-bit order and omit unselected channels',()=>{
 const command=selectedLightCommand(['11','22','33','44','55','66','77','88'],[true,false,true,false,false,false,false,true]);
 assert.deepEqual(Array.from(command.data),[0,133,11,33,88]);
 assert.throws(()=>selectedLightCommand(['1.5',...Array(7).fill('0')],Array(8).fill(true)));
 assert.throws(()=>selectedLightCommand(Array(8).fill('0'),Array(8).fill(false)));
});
test('heading wraps in both directions without accepting fractional speed',()=>{
 assert.deepEqual(Array.from(headingCommand('25','-1').data),[25,1,103,0]);
 assert.deepEqual(Array.from(headingCommand('25','721').data),[25,0,1,0]);
 assert.throws(()=>headingCommand('1.5','0'));
});
test('queried articulation never turns malformed or nonfinite bytes into a reading',()=>{
 assert.equal(readFloatResponse({data:Uint8Array.from([0x43,0x36,0,0])}),182);
 assert.throws(()=>readFloatResponse({data:new Uint8Array(3)}));
 assert.throws(()=>readFloatResponse({data:Uint8Array.from([127,128,0,0])}));
});

test('bounded drive releases at 200 ms even when the droid never acknowledges',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {boundedDrive}=await import('../../core/controlValues.ts');let releases=0;
 const pulse=boundedDrive(()=>new Promise(()=>{}),async()=>{releases++;},async()=>{});
 t.mock.timers.tick(199);await Promise.resolve();assert.equal(releases,0);
 t.mock.timers.tick(1);await Promise.resolve();assert.equal(releases,1);
 await pulse;
});
test('bounded drive does not stop an existing owner when its demand is rejected',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {boundedDrive}=await import('../../core/controlValues.ts');
 const {ResourceConflictError}=await import('../../core/index.ts');let releases=0;
 const conflict=new ResourceConflictError(['active recipe'],'manual drive');
 await assert.rejects(boundedDrive(async()=>{throw conflict;},async()=>{releases++;},async()=>{}),ResourceConflictError);
 t.mock.timers.tick(1000);await Promise.resolve();assert.equal(releases,0);
});
test('canceling an old pulse revokes its timer before a new source can be stopped',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {boundedDrive}=await import('../../core/controlValues.ts');let releases=0;
 const abort=new AbortController();
 const pulse=boundedDrive(async()=>{},async()=>{releases++;},async()=>{},{signal:abort.signal});
 abort.abort('replacement-barrier');await pulse;
 t.mock.timers.tick(1000);await Promise.resolve();assert.equal(releases,0);
});
test('pulse cancellation on navigation releases immediately and never releases twice',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {boundedDrive}=await import('../../core/controlValues.ts');let releases=0;
 const abort=new AbortController();
 const pulse=boundedDrive(()=>new Promise(()=>{}),async()=>{releases++;},async()=>{},{signal:abort.signal});
 abort.abort();await pulse;assert.equal(releases,1);
 t.mock.timers.tick(1000);await Promise.resolve();assert.equal(releases,1);
});
test('failed pulse release attempts emergency stop',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {boundedDrive}=await import('../../core/controlValues.ts');let stopped=false;
 const pulse=boundedDrive(async()=>{},async()=>{throw new Error('release failure');},async()=>{stopped=true;});
 t.mock.timers.tick(200);await assert.rejects(pulse,/release failure/);assert.equal(stopped,true);
});
test('confirmed replacement always awaits the physical stop barrier before an ordinary write',async()=>{
 const {applyReplacement}=await import('../../core/controlValues.ts');const events:string[]=[];
 let complete!:()=>void;const barrier=new Promise<void>(resolve=>{complete=resolve;});
 const action=applyReplacement({replaceSources:()=>{events.push('barrier');return barrier;},armMotion:()=>{events.push('arm');},execute:async()=>{events.push('command');}}, {did:0x1a,cid:8,data:new Uint8Array([20])},()=>true);
 assert.deepEqual(events,['barrier']);complete();await action;assert.deepEqual(events,['barrier','arm','command']);
});
test('replacement does not rearm after STOP and drive replacement requires fresh input',async()=>{
 const {applyReplacement}=await import('../../core/controlValues.ts');let armed=0,writes=0;
 const port={replaceSources:async()=>{},armMotion:()=>{armed++;},execute:async()=>{writes++;}};
 await assert.rejects(applyReplacement(port,{did:0x1a,cid:8,data:new Uint8Array([20])},()=>false),/canceled/);
 await applyReplacement(port,{did:0x16,cid:8,data:new Uint8Array([20,20,0])},()=>true);
 assert.equal(armed,0);assert.equal(writes,0);
});
test('accessible repeated activation does not extend the first200ms browser deadline while ACK is missing',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const {AccessiblePulseRunner}=await import('../../core/accessiblePulse.ts');const {boundedDrive}=await import('../../core/controlValues.ts');const runner=new AccessiblePulseRunner();let writes=0,releases=0;
 const execute=async(_command:unknown,signal:AbortSignal)=>boundedDrive(()=>{writes++;return new Promise(()=>{});},async()=>{releases++;},async()=>{},{signal,durationMs:200});
 const pulse=runner.start('Forward',10,100,execute);t.mock.timers.tick(100);await assert.rejects(runner.start('Forward',10,100,execute),/already active/);t.mock.timers.tick(99);assert.equal(releases,0);t.mock.timers.tick(1);await pulse;assert.equal(releases,1);assert.equal(writes,1);
});

test('native pulse uses native completion without a JavaScript deadline and joins cancellation cleanup',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {nativeBoundedDrive}=await import('../../core/controlValues.ts');const abort=new AbortController();let finish!:()=>void;let finishZero!:()=>void;let zeros=0,done=false;
 const pulse=nativeBoundedDrive(()=>new Promise<void>(r=>finish=r),()=>{zeros++;return new Promise<void>(r=>finishZero=r);},async()=>{},abort.signal).then(()=>{done=true;});
 t.mock.timers.tick(5000);await Promise.resolve();assert.equal(zeros,0);assert.equal(done,false);
 abort.abort();assert.equal(zeros,1);finish();await Promise.resolve();assert.equal(done,false);finishZero();await pulse;assert.equal(done,true);
});
test('native replacement cancellation leaves zero to the caller barrier',async()=>{
 const {nativeBoundedDrive}=await import('../../core/controlValues.ts');const abort=new AbortController();let finish!:()=>void;let zeros=0;
 const pulse=nativeBoundedDrive(()=>new Promise<void>(r=>finish=r),async()=>{zeros++;},async()=>{},abort.signal);
 abort.abort('replacement-barrier');finish();await pulse;assert.equal(zeros,0);
});
