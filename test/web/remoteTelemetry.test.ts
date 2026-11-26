import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteSession} from '../../web/remoteSession.ts';
import {SessionStore} from '../../app/session/store.ts';

function fixture(telemetry = true) {
  const calls: Array<{path:string; body:any}> = [];
  const snapshot = new SessionStore({state:'ready',detail:'Ready',packets:[]}).getSnapshot();
  snapshot.sensors = {status:'streaming',values:{'accelerometer.x':1.25,'rawGyroscope.z':-3},invalid:0,intervalMs:1000,schemaEpoch:1,sampleAt:1234};
  snapshot.cockpitReadings = {'dome.degrees':{value:-45,at:1234},'encoder.0':{value:123,at:1234}};
  const port = new RemoteSession({base:'http://fixture/api/v1/',clientId:'visible-tab',subscribeChanges:()=>()=>{},fetch:async(input,init)=>{
    const path=new URL(String(input)).pathname,body=init?.body?JSON.parse(String(init.body)):undefined;
    calls.push({path,body});
    const value=path.endsWith('/preferences')?{revision:0,values:{}}:path.includes('/catalogs/')?{items:[]}:path.endsWith('/ui/release')?{state:'stopped'}:{droid_id:'r2',name:'R2',session:snapshot,capabilities:{telemetry}};
    return new Response(JSON.stringify(value));
  }});
  return {port,calls,beats:()=>calls.filter(call=>call.path.endsWith('/ui/heartbeat'))};
}

test('cockpit subscription requests 1Hz telemetry only while visible and releases last observer immediately',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.start();
  assert.equal(f.beats().at(-1)?.body.telemetry,false);
  const first=f.port.observeCockpitTelemetry(),second=f.port.observeCockpitTelemetry();
  assert.equal(f.beats().at(-1)?.body.telemetry,true);
  first();first();assert.equal(f.beats().at(-1)?.body.telemetry,true);
  second();assert.equal(f.beats().at(-1)?.body.telemetry,false);
  const count=f.beats().length;t.mock.timers.tick(999);assert.equal(f.beats().length,count);
  t.mock.timers.tick(1);assert.equal(f.beats().length,count+1);
  assert.ok(!f.calls.some(call=>call.body?.action==='connection.connect'));
});

test('focus loss releases observation and returning focus restores only mounted demand',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.start();
  const release=f.port.observeCockpitTelemetry();
  f.port.handleWindowBlur(true);
  await new Promise(setImmediate);
  const before=f.beats().length;t.mock.timers.tick(3000);assert.equal(f.beats().length,before);
  assert.ok(f.calls.some(call=>call.path.endsWith('/ui/release')));
  release();assert.equal(f.beats().length,before);
  await f.port.handleWindowFocus();assert.equal(f.beats().at(-1)?.body.telemetry,false);
});

test('explicit sensors and cockpit observers share demand without one stopping the other',async t=>{
  const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.start();
  const release=f.port.observeCockpitTelemetry();await f.port.startSensors();release();
  assert.equal(f.beats().at(-1)?.body.telemetry,true);
  await f.port.stopSensors();assert.equal(f.beats().at(-1)?.body.telemetry,false);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/operations')).length,0);
});

test('standalone service receives no unsupported telemetry lease extension',async t=>{
  const f=fixture(false);t.after(()=>f.port.dispose());await f.port.selectDroid('r2');f.port.start();
  const release=f.port.observeCockpitTelemetry();release();
  assert.ok(f.beats().every(call=>!('telemetry' in call.body)));
  await assert.rejects(f.port.startSensors(),/unavailable/i);
});

test('remote cockpit retains timestamped sensor and readback payloads from HA snapshot',async t=>{
  const f=fixture();t.after(()=>f.port.dispose());await f.port.selectDroid('r2');
  assert.equal(f.port.store.getSnapshot().sensors?.values['accelerometer.x'],1.25);
  assert.equal(f.port.store.getSnapshot().sensors?.intervalMs,1000);
  assert.deepEqual(f.port.store.getSnapshot().cockpitReadings?.['dome.degrees'],{value:-45,at:1234});
});
