import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteSession} from '../../web/remoteSession.ts';
import {SessionStore} from '../../app/session/store.ts';
import {ManualControls} from '../../app/cockpit/ManualControls.ts';
import {commands} from '../../core/commands.ts';

const flush=()=>new Promise<void>(setImmediate);
function fixture(motion=true, responseTokens=false){
 const calls:Array<{path:string,body:any}>=[];
 const gates=new Map<string,{started:()=>void,wait:Promise<void>}>();
 let failedStop=false,unconfirmedStop=false,failedCommand=false,serial=0,driveStopUnconfirmed=false;
 let transition: {client_id:string;transitioning:boolean}|undefined;
 const snapshot=new SessionStore({state:'ready',detail:'Ready',packets:[]}).getSnapshot();
 snapshot.safety.canControl=true;
 const port=new RemoteSession({base:'http://fixture/api/v1/',clientId:'cockpit',fetch:async(input,init)=>{
  const path=new URL(String(input)).pathname,body=init?.body?JSON.parse(String(init.body)):undefined;
  calls.push({path,body});
  let value:any={};
  if(path.endsWith('/preferences'))value={revision:0,values:{}};
  else if(path.endsWith('/catalogs/animations'))value={items:[{id:'animation:16',firmware_id:16,available:true,effects:['motion','audio']}]};
  else if(path.includes('/catalogs/'))value={items:[]};
  else if(path.endsWith('/motion/open'))value={lease_id:`lease${++serial}`,token:`token${serial}`};
  else if(path.endsWith('/motion/challenge'))value={token:`token${++serial}`};
  else if(path.endsWith('/motion/command'))value=failedCommand?{state:'failed'}:{state:'dispatched',confirmation:body.action==='renew'?'none':'ack',...(responseTokens?{token:`next${++serial}`}:{})};
  else if(path.endsWith('/motion/release')||path.endsWith('/ui/release'))value=failedStop?{state:'failed',stop:{state:'failed',error:'STOP failed'}}:unconfirmedStop?{}:{state:'stopped'};
  else if(path.endsWith('/operations'))value={operation_id:'op',state:'dispatched'};
  else value={droid_id:'r2',name:'R2',session:snapshot,motion:transition,capabilities:{motion,driveStopUnconfirmed,telemetry:true}};
  const gate=gates.get(path);if(gate){gates.delete(path);gate.started();await gate.wait;}
  return new Response(JSON.stringify(value));
 }});
 return {port,calls,recoverableStop(){snapshot.stopFailure='Wheel stop is unconfirmed';snapshot.connection.state='connected';driveStopUnconfirmed=true;},transition(client='cockpit',state: 'connecting'|'failed'|'disconnected'='connecting',epoch=snapshot.connection.epoch){transition={client_id:client,transitioning:true};snapshot.state=state;snapshot.connection={...snapshot.connection,state,epoch};snapshot.safety.canControl=false;},failCommand(value=true){failedCommand=value;},failStop(){failedStop=true;},unconfirmedStop(){unconfirmedStop=true;},hold(suffix:string){let release!:()=>void,started!:()=>void;const wait=new Promise<void>(r=>release=r),begun=new Promise<void>(r=>started=r);gates.set('/api/v1/droids/r2/motion/'+suffix,{started,wait});return {release,started:begun};},effects:()=>calls.filter(c=>c.path.endsWith('/motion/command'))};
}

test('cockpit pointer drive produces semantic tank demand and release STOP, without disconnect',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 assert.equal(f.port.motionAvailable,true);
 const errors:unknown[]=[];const manual=new ManualControls(f.port,()=>true,e=>errors.push(e));t.after(()=>manual.dispose());
 assert.equal(manual.begin('pointer'),true);manual.move('pointer',[0,1],25);await flush();
 assert.deepEqual(f.effects()[0]?.body,{client_id:'cockpit',lease_id:'lease1',token:'token1',action:'drive',parameters:{left:64,right:64,flags:0}});
 await f.port.refresh();assert.equal(f.port.manualMotion.active,true,'ready snapshots must retain active controls');
 await manual.release();assert.equal(f.port.manualMotion.active,false);assert.ok(f.calls.some(c=>c.path.endsWith('/motion/release')));assert.deepEqual(errors,[]);
 assert.ok(!f.calls.some(c=>c.body?.action==='connection.disconnect'));
});

test('cockpit dome, stance and No animation preserve semantic actions and firmware ID',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 for(const [command,action,parameters] of [[commands.head(-45),'dome',{degrees:-45}],[commands.legAction(2),'stance',{stance:'two'}],[commands.animation(16),'animation',{animation_id:'animation:16'}]] as const){
  f.port.armMotion();await f.port.executeManual(command);assert.deepEqual(f.effects().at(-1)?.body.parameters,parameters);assert.equal(f.effects().at(-1)?.body.action,action);
 }
 assert.ok(!f.calls.some(c=>c.body?.action==='sound.play'));
});

for(const stage of ['open','challenge'])for(const boundary of ['release','blur','dispose','selection'])test(`late ${stage} cannot dispatch after ${boundary}`,async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 if(stage==='challenge')await f.port.setDome(20);
 const gate=f.hold(stage),pending=f.port.setDome(60).catch(e=>e);await gate.started;
 const before=f.effects().length;
 let done:Promise<unknown>|undefined;
 if(boundary==='release')done=f.port.release();else if(boundary==='blur')f.port.handleWindowBlur(true);else if(boundary==='dispose')f.port.dispose();else done=f.port.selectDroid('r3');
 assert.equal(f.port.manualMotion.active,false);gate.release();await pending;await done;await flush();
 assert.equal(f.effects().length,before);assert.ok(f.calls.some(c=>c.path.endsWith('/motion/release')));
});

test('failed motion release remains latched through refresh and focus return',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(30);f.failStop();
 await assert.rejects(f.port.release(),/STOP failed/);await f.port.refresh();await f.port.handleWindowFocus();
 assert.equal(f.port.store.getSnapshot().state,'failed');assert.throws(()=>f.port.armMotion(),/paused|failed/i);
});

test('standalone capability false rejects all motion entry points without transport effects',async t=>{
 const f=fixture(false);t.after(()=>f.port.dispose());await f.port.selectDroid('r2');const before=f.calls.length;
 assert.throws(()=>f.port.drive(0,1,25),/unavailable/i);await assert.rejects(f.port.setDome(20),/unavailable/i);await assert.rejects(f.port.execute(commands.animation(16)),/unavailable/i);assert.equal(f.calls.length,before);
});

test('a blocked challenge coalesces joystick targets and renewals never overlap',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.drive(0,1,25);await flush();
 const gate=f.hold('challenge');t.mock.timers.tick(100);await gate.started;
 f.port.drive(1,0,25);f.port.drive(0,-1,50);t.mock.timers.tick(60);await flush();
 assert.equal(f.calls.filter(c=>c.path.endsWith('/motion/challenge')).length,1);
 gate.release();await flush();assert.deepEqual(f.effects().at(-1)?.body.parameters,{left:128,right:128,flags:24});
 assert.equal(f.effects().length,2,'old targets must never be replayed after a slow challenge');
});

test('dome renews without replaying the target and releases at its bounded deadline',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(90);
 t.mock.timers.tick(100);await flush();assert.equal(f.effects().at(-1)?.body.action,'renew');assert.deepEqual(f.effects().at(-1)?.body.parameters,{});assert.equal(f.port.store.getSnapshot().state,'ready');assert.ok(!f.calls.some(c=>c.path.endsWith('/motion/release')));
 t.mock.timers.tick(5000);await flush();assert.ok(f.calls.some(c=>c.path.endsWith('/motion/release')));const count=f.effects().length;
 t.mock.timers.tick(1000);await flush();assert.equal(f.effects().length,count);
});

test('action-kind replacement waits for STOP and blur cancels its pending new open',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(30);
 const gate=f.hold('release');const pending=f.port.setStance('three').catch(e=>e);await gate.started;
 f.port.handleWindowBlur(true);gate.release();assert.ok(await pending instanceof Error);await flush();
 assert.equal(f.calls.filter(c=>c.path.endsWith('/motion/open')).length,1);
});

test('a canceled initial motion acknowledgment cannot be replayed by the renewal timer',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 const gate=f.hold('command');const pending=f.port.setDome(40);await gate.started;f.port.handleWindowBlur(true);gate.release();await assert.rejects(pending,/canceled/);
 t.mock.timers.tick(1000);await flush();assert.equal(f.effects().length,1);
});


test('rejected joystick demand revokes ownership and waits for STOP without a false failure latch',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.failCommand();
 const manual=new ManualControls(f.port,()=>true,()=>{});t.after(()=>manual.dispose());
 const gate=f.hold('release');
 assert.equal(manual.begin('pointer'),true);manual.move('pointer',[0,1],25);await gate.started;
 assert.equal(f.port.manualMotion.active,false);
 assert.equal(f.port.store.getSnapshot().safety.motionArmed,false);
 assert.throws(()=>f.port.drive(0,1,25),/STOP|paused/);
 gate.release();await flush();await f.port.refresh();
 assert.equal(f.port.store.getSnapshot().state,'ready');
 t.mock.timers.tick(1000);await flush();assert.equal(f.effects().length,1);
 f.failCommand(false);f.port.setDriveSpeed(50);await flush();assert.equal(f.effects().length,1,'cached demand was revoked');
 assert.equal(manual.begin('pointer'),true);manual.move('pointer',[0,1],25);await flush();
 assert.equal(f.effects().length,2,'a fresh gesture can start after acknowledged STOP');
 assert.ok(!f.calls.some(c=>c.body?.action==='connection.disconnect'));
});

test('rejected command with failed cleanup STOP remains blocked',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.failCommand();f.failStop();
 await assert.rejects(f.port.setDome(40));await flush();await f.port.refresh();await f.port.handleWindowFocus();
 assert.equal(f.port.store.getSnapshot().state,'failed');
 assert.throws(()=>f.port.armMotion(),/paused|failed/);
});

test('release of a pending open propagates a failed late lease STOP',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 const gate=f.hold('open');const pending=f.port.setDome(40).catch(e=>e);await gate.started;
 const release=f.port.release();f.failStop();gate.release();
 await assert.rejects(release,/STOP failed/);await pending;assert.equal(f.port.store.getSnapshot().state,'failed');assert.equal(f.effects().length,0);
});


test('explicit STOP disarms even when the server remains ready',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.validateWheels();await f.port.setDome(20);
 await f.port.stop();assert.equal(f.port.store.getSnapshot().safety.motionArmed,false);
});

test('ordinary operations wait for motion STOP and cannot resume after blur',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(20);
 const gate=f.hold('release');const pending=f.port.operation('lights.apply',{settings:{readouts:20}}).catch(e=>e);
 await flush();assert.ok(!f.calls.some(c=>c.body?.action==='lights.apply'));await gate.started;
 f.port.handleWindowBlur(true);gate.release();assert.ok(await pending instanceof Error);assert.ok(!f.calls.some(c=>c.body?.action==='lights.apply'));
});

test('reselecting same droid waits for motion STOP before reporting ready for a new action',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(20);
 const gate=f.hold('release');let selected=false;const pending=f.port.selectDroid('r2').then(()=>{selected=true;});await gate.started;await flush();assert.equal(selected,false);
 gate.release();await pending;await f.port.setDome(40);assert.equal(f.effects().at(-1)?.body.parameters.degrees,40);
});

test('pointer bursts between ticks retain only newest target and never exceed ten command starts per second',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.drive(0,1,25);await flush();
 f.port.drive(1,0,25);await flush();f.port.drive(0,-1,50);await flush();assert.equal(f.effects().length,1);
 t.mock.timers.tick(100);await flush();assert.equal(f.effects().length,2);assert.deepEqual(f.effects().at(-1)?.body.parameters,{left:128,right:128,flags:24});
});


for(const stage of ['open','release'])test(`own STOP transition during ${stage} retains ready controls and does not cancel the new action`,async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');if(stage==='release')await f.port.setStance('three');
 const gate=f.hold(stage);const pending=f.port.setDome(20);await gate.started;
 f.transition();await f.port.refresh();assert.equal(f.port.store.getSnapshot().state,'ready');assert.equal(f.port.store.getSnapshot().safety.canControl,true);
 gate.release();await pending;assert.equal(f.effects().at(-1)?.body.action,'dome');
});

for(const boundary of ['other owner','failure','disconnection','epoch'])test(`transition marker cannot hide ${boundary}`,async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');const gate=f.hold('open');const pending=f.port.setDome(20).catch(e=>e);await gate.started;
 if(boundary==='other owner')f.transition('other');else if(boundary==='failure')f.transition('cockpit','failed');else if(boundary==='disconnection')f.transition('cockpit','disconnected');else f.transition('cockpit','connecting',999);
 await f.port.refresh();gate.release();assert.ok(await pending instanceof Error);assert.equal(f.effects().length,0);
});

test('a captured own STOP transition arriving after open settles cannot revoke its live lease',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(20);
 f.transition();await f.port.refresh();assert.equal(f.port.store.getSnapshot().state,'ready');assert.equal(f.port.store.getSnapshot().safety.canControl,true);
 assert.ok(!f.calls.some(c=>c.path.endsWith('/motion/release')));
});

test('drive expiry synchronously revokes joystick ownership and gear changes cannot replay its last demand',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 const manual=new ManualControls(f.port,()=>true,()=>{});t.after(()=>manual.dispose());assert.equal(manual.begin('pointer'),true);manual.move('pointer',[0,1],25);await flush();
 const stopped=f.hold('release');t.mock.timers.tick(60000);
 assert.equal(f.port.manualMotion.active,false);assert.equal(f.port.store.getSnapshot().safety.motionArmed,false);
 await stopped.started;const effects=f.effects().length;
 f.port.setDriveSpeed(50);manual.move('pointer',[0,1],50);stopped.release();await flush();
 f.port.setDriveSpeed(75);t.mock.timers.tick(100);await flush();
 assert.equal(f.effects().length,effects);assert.equal(f.calls.filter(c=>c.path.endsWith('/motion/open')).length,1);
});

for(const [kind,duration] of [['dome',5000],['stance',10000]] as const)test(`${kind} expiry disarms and cancels local controls before STOP confirmation`,async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 if(kind==='dome')await f.port.setDome(30);else await f.port.setStance('three');
 let canceled=false;f.port.registerCancel(()=>{canceled=true;});const stopped=f.hold('release');t.mock.timers.tick(duration);
 assert.equal(f.port.store.getSnapshot().safety.motionArmed,false);assert.equal(canceled,true);
 stopped.release();await flush();
});

test('acknowledgments supply one-use tokens for subsequent joystick updates without a challenge round trip',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const f=fixture(true,true);t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 f.port.drive(0,1,25);await flush();
 for(let i=0;i<5;i++){t.mock.timers.tick(100);await flush();}
 assert.equal(f.effects().length,6);
 assert.equal(new Set(f.effects().map(c=>c.body.token)).size,6);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/motion/challenge')).length,0);
 await f.port.release();const count=f.effects().length;
 t.mock.timers.tick(500);await flush();assert.equal(f.effects().length,count);
 f.port.drive(0,1,25);await flush();
 assert.notEqual(f.effects().at(-1)?.body.lease_id,f.effects()[0].body.lease_id);
 assert.match(f.effects().at(-1)?.body.token,/^token/,'a new gesture must use its new lease token');
});

test('late acknowledgment with a next token cannot revive motion after release',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 const f=fixture(true,true);t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
 const gate=f.hold('command');f.port.drive(0,1,25);await gate.started;
 const stopped=f.port.release();gate.release();await stopped;
 t.mock.timers.tick(1000);await flush();assert.equal(f.effects().length,1);
 assert.equal(f.port.store.getSnapshot().safety.motionArmed,false);
});

test('missing STOP completion cannot release the failure latch',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(30);
 f.unconfirmedStop();await assert.rejects(f.port.release(),/STOP/);
 await f.port.refresh();assert.equal(f.port.store.getSnapshot().state,'failed');
});

test('a renewal due during a slow acknowledgment runs immediately after it, without overlapping writes', async t => {
 t.mock.timers.enable({apis:['setInterval','Date']});
 const {RemoteMotion}=await import('../../web/remoteMotion.ts');
 let finish!: (value:unknown)=>void;
 const sent:number[]=[];
 let active=0,maxActive=0;
 const motion=new RemoteMotion(async(path,method,body:any)=>{
  if(path.endsWith('/open'))return {lease_id:'lease',token:'one'} as any;
  if(path.endsWith('/release'))return {state:'completed'} as any;
  sent.push(Date.now());active++;maxActive=Math.max(maxActive,active);
  if(sent.length===1)await new Promise(resolve=>{finish=resolve;});
  active--;
  return {state:'dispatched',confirmation:'ack',token:'next'+sent.length} as any;
 },'tab',()=>{},()=>{});
 const first=motion.set('/motion','drive',{left:20,right:20,flags:0},1000);
 await flush();
 t.mock.timers.tick(160);await flush();
 assert.equal(sent.length,1);
 finish(undefined);await first;await flush();
 assert.deepEqual(sent,[0,160],'do not wait for the next 200 ms interval after a renewal was due');
 assert.equal(maxActive,1);
 await motion.release();
 t.mock.timers.tick(1000);await flush();assert.equal(sent.length,2,'release cancels overdue renewal');
});


test('server-confirmed scoped STOP failure permits dome and sound but blocks wheel demand',async t=>{
 const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');await f.port.setDome(20);f.failStop();
 await assert.rejects(f.port.release());f.recoverableStop();await f.port.refresh();
 assert.equal(f.port.store.getSnapshot().safety.canControl,true);
 assert.equal(f.port.motionAvailable,false);
 assert.throws(()=>f.port.drive(0,1),/stop|unavailable/i);
 await assert.rejects(f.port.execute(commands.tank(10,10)),/stop|unavailable/i);
 await f.port.setDome(30);
 assert.equal(f.effects().at(-1)?.body.parameters.degrees,30);
 await f.port.setStance('waddle');
 await f.port.operation('sound.play',{sound_id:'sound:23'});
 assert.ok(!f.effects().some(c=>c.body.action==='drive'));
});
