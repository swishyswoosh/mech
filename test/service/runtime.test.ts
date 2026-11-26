import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDroidRuntime} from '../../service/droidRuntime.ts';
import {encodePacket,PacketDecoder,UUIDS} from '../../core/index.ts';
import type {BleTransport,Packet} from '../../core/index.ts';
import {operationBody} from '../../service/validation.ts';

test('an explicit light recipe survives intervening shared saves and is captured before execution', async () => {
  const f = fixture();
  const recipe = {version: 1, name: 'Chosen lights', frames: [
    {atMs: 0, transitionMs: 80, controls: [1, 2, 3, 4, 5, 6, 7, 8]},
  ]};
  f.preferences.save('device.light-recipe.v1', 'A different saved recipe');
  try {
    const request = operationBody({action: 'protocol.run', parameters: {protocol_id: 'protocol-device-lights', recipe}});
    const prepared = f.runtime.prepare(request.action, request.parameters);
    recipe.frames[0].controls[0] = 99;
    await f.runtime.connect();
    await f.runtime.stop();
    await prepared.execute();
    const packet = f.written.find(p => p.did === 23 && p.cid === 26)!;
    assert.deepEqual([...packet.data], [0, 0, 255, 0, 0, 15, 1, 2, 3, 4, 5, 6, 7, 8, 0, 80, 254]);
  } finally { await f.runtime.dispose(); }
});

test('inline light recipes retain the light-only validation boundary', async () => {
  const f = fixture();
  try {
    for (const extra of [{audio: 1609}, {type: 'drive', speed: 1}]) {
      assert.throws(() => f.runtime.prepare('protocol.run', {
        protocol_id: 'protocol-device-lights', recipe: {version: 1, name: 'Mixed', frames: [
          {atMs: 0, transitionMs: 80, controls: [1, 2, 3, 4, 5, 6, 7, 8], ...extra},
        ]},
      }));
    }
    assert.equal(f.opens, 0);
    assert.equal(f.written.length, 0);
  } finally { await f.runtime.dispose(); }
});

function fixture(id='test') {
  let opens=0,closes=0,stops=0,stopFailure=false,sleepNotify=true,legFailure=0;
  let closeWork=async()=>{};
  let deliver=(_bytes:Uint8Array)=>{};
  const written:Packet[]=[],decoder=new PacketDecoder(),prefs=new Map<string,string>();
  const transport:BleTransport={
    discover:async()=>Object.values(UUIDS).map(characteristic=>({service:'test',characteristic})),
    read:async()=>Uint8Array.of(0,0,0,0,2,0,0,0),
    subscribe:async(ref,listener)=>{if(ref.characteristic===UUIDS.api)deliver=listener;return()=>{};},
    write:async(ref,bytes)=>{if(ref.characteristic!==UUIDS.api)return;for(const p of decoder.push(bytes)){
      written.push(p);deliver(encodePacket({...p,flags:1,error:p.did===23&&p.cid===13?legFailure:0,data:p.did===17?Uint8Array.of(0,7,0,0,0,101):Uint8Array.of(1,2)}));
      if(sleepNotify&&p.did===19&&p.cid===1)queueMicrotask(()=>deliver(encodePacket({did:19,cid:26,seq:255,flags:0,data:new Uint8Array()})));
    }},
    emergencyWrite:async()=>{stops++;if(stopFailure)throw Error('STOP radio failed');},
    disconnect:async()=>{closes++;await closeWork();},
  };
  const preferences={load:(key:string)=>prefs.get(key)??null,save:(key:string,value:string)=>{prefs.set(key,value);}};
  const factory={open:async()=>{opens++;return{transport,id,name:'R2'};}};
  const runtime=createDroidRuntime({id,name:'R2',factory,preferences});
  return{runtime,factory,preferences,written,setClose:(work:()=>Promise<void>)=>{closeWork=work;},get opens(){return opens;},get closes(){return closes;},get stops(){return stops;},failLeg:(error:number)=>{legFailure=error;},failStop:()=>{stopFailure=true;},noSleep:()=>{sleepNotify=false;},emitSleep:()=>deliver(encodePacket({did:19,cid:26,seq:255,flags:0,data:new Uint8Array()}))};
}

test('creating, reading, subscribing and catalog lookup never open a transport',async()=>{
  const f=fixture();let updates=0;const off=f.runtime.subscribe(()=>updates++);
  assert.equal(f.runtime.snapshot().state,'disconnected');assert.ok(updates>=1);
  assert.ok(f.runtime.catalogs('sounds').items.some(item=>item.id==='sound:139'));
  assert.ok(f.runtime.catalogs('animations').items.every(item=>!item.available));
  assert.equal(f.opens,0);assert.equal(f.written.length,0);off();await f.runtime.dispose();
});

test('explicit connect retains unknown firmware busy until acknowledged STOP cleanup, with no streaming',async()=>{
  const f=fixture();try{await f.runtime.connect();assert.equal(f.runtime.snapshot().state,'ready');assert.equal(f.runtime.busy(),true);
    assert.equal(f.written.some(p=>p.did===24),false);await f.runtime.stop();assert.equal(f.runtime.busy(),false);
    assert.equal(f.closes,0);assert.equal(f.runtime.snapshot().safety.motionArmed,false);
  }finally{await f.runtime.dispose();}
});

test('sound ACK means dispatched and unknown duration remains busy until stop',async()=>{
  const f=fixture();try{await f.runtime.connect();await f.runtime.stop();const result=await f.runtime.execute('sound.play',{sound_id:'sound:139'});
    assert.equal(result.state,'dispatched');assert.equal(result.confirmation,'ack');assert.equal(f.runtime.busy(),true);
    assert.ok(f.written.some(p=>p.did===26&&p.cid===7));await f.runtime.stop();assert.equal(f.runtime.busy(),false);
  }finally{await f.runtime.dispose();}
});

test('light settings preserve readout/rear RGB wire order and static lights are not ongoing activity',async()=>{
  const f=fixture();try{await f.runtime.connect();await f.runtime.stop();await f.runtime.execute('lights.apply',{settings:{rear_dome_red:23,readouts:61}});
    const p=f.written.at(-1)!;assert.equal(p.did,26);assert.deepEqual([...p.data],[0,24,61,23]);assert.equal(f.runtime.busy(),false);
    const count=f.written.length;await assert.rejects(f.runtime.execute('lights.apply',{settings:{unknown:1}}),/channel|settings/i);assert.equal(f.written.length,count);
  }finally{await f.runtime.dispose();}
});

test('motion, raw commands, unknown sounds and mixed RAM content fail before BLE dispatch',async()=>{
  const f=fixture();for(const [action,parameters] of [['drive',{speed:1}],['dome.set',{degrees:10}],['stance.set',{stance:'two'}],['animation.play',{animation_id:'animation:13'}],['path.run',{path_id:'x'}],['command',{did:26,cid:7}],['sound.play',{sound_id:'sound:999'}],['protocol.run',{protocol_id:'unknown',recipe:{audio:1}}]] as const){await assert.rejects(f.runtime.execute(action,parameters));}
  assert.equal(f.opens,0);assert.equal(f.written.length,0);await f.runtime.dispose();
});

test('disconnect waits for did-sleep instead of treating ACK as completion',async()=>{
  const f=fixture();await f.runtime.connect();f.noSleep();let finished=false;const work=f.runtime.disconnect().then(()=>{finished=true;});
  for(let i=0;i<100;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.written.some(p=>p.did===19&&p.cid===1));assert.equal(finished,false);assert.equal(f.closes,0);
  f.emitSleep();await work;assert.equal(f.closes,1);assert.equal(f.runtime.snapshot().state,'sleeping');assert.equal(f.runtime.snapshot().connection.state,'disconnected');await f.runtime.dispose();
});

test('failed STOP preserves unrelated controls and never replaces the live link',async()=>{
  const f=fixture();
  try {
    await f.runtime.connect();f.failStop();await assert.rejects(f.runtime.stop(),/STOP radio failed/);
    assert.match(f.runtime.snapshot().stopFailure ?? '',/STOP radio failed/);
    await f.runtime.connect();assert.equal(f.opens,1);assert.equal(f.closes,0);
    await f.runtime.execute('sound.play',{sound_id:'sound:139'});
    assert.equal(f.runtime.snapshot().safety.canControl,true);
  } finally {await f.runtime.dispose().catch(()=>{});}
});

test('transport faults stay blocked when asynchronous fault persistence rejects',async()=>{
  const f=fixture('async-fault');
  const save=f.preferences.save;
  f.preferences.save=(key,value)=>{
    if(key.startsWith('service.runtime.fault.'))return Promise.reject(Error('Fault storage unavailable'));
    save(key,value);
  };
  try{
    await f.runtime.connect();f.failLeg(5);
    await assert.rejects(f.runtime.disconnect(),/Droid error/);
    await new Promise(setImmediate);
    assert.equal(f.runtime.snapshot().state,'failed');
    assert.equal(f.runtime.snapshot().safety.canControl,false);
    assert.equal(f.closes,0);
  }finally{await f.runtime.dispose().catch(()=>{});}
});

test('generic sleep preparation rejection retains a failure and never sends sleep',async()=>{
  const f=fixture();try{await f.runtime.connect();f.failLeg(5);await assert.rejects(f.runtime.disconnect(),/Droid error/);
    assert.equal(f.runtime.snapshot().state,'failed');assert.equal(f.closes,0);assert.equal(f.written.some(p=>p.did===19&&p.cid===1),false);
  }finally{await f.runtime.dispose();}
});

test('existing low-battery leg-hold exception still requires separately confirmed sleep',async()=>{
  const f=fixture();try{await f.runtime.connect();f.failLeg(4);await f.runtime.disconnect();assert.ok(f.written.some(p=>p.did===19&&p.cid===1));assert.equal(f.closes,1);}finally{await f.runtime.dispose();}
});

test('saved light preset keeps its identity when renamed and uses supplied service preferences',async()=>{
  const f=fixture();const save=(name:string)=>f.preferences.save('lightPresets.v1',JSON.stringify({version:1,presets:[{id:'my-light',name,values:[1,2,3,4,5,6,7,8],selected:Array(8).fill(true)}]}));
  save('Evening');assert.ok(f.runtime.catalogs('light_presets').items.some(item=>item.id==='my-light'&&item.name==='Evening'));
  save('Bedtime');assert.ok(f.runtime.catalogs('light_presets').items.some(item=>item.id==='my-light'&&item.name==='Bedtime'));assert.equal(f.opens,0);await f.runtime.dispose();
});

test('vetted light protocol uses managed firmware validation and cleanup, never reports physical completion',async()=>{
  const f=fixture();f.preferences.save('device.light-recipe.v1',JSON.stringify({version:1,name:'Short fade',frames:[{atMs:0,controls:[0,0,10,0,0,10,0,0],transitionMs:80}]}));
  const prepared=f.runtime.prepare('protocol.run',{protocol_id:'protocol-device-lights'});
  (prepared.parameters.resolved_recipe as {frames:unknown[]}).frames=[];
  f.preferences.save('device.light-recipe.v1','invalid JSON after admission');
  try{await f.runtime.connect();await f.runtime.stop();const result=await prepared.execute();
    assert.equal(result.state,'dispatched');assert.equal(result.confirmation,'ack');assert.deepEqual(result.evidence,{cleanup_acknowledged:true,physical_completion:false});
    assert.ok(f.written.some(p=>p.did===23&&p.cid===26&&p.data.length>6));assert.equal(f.runtime.busy(),false);
  }finally{await f.runtime.dispose();}
});

test('audio or motion mixed into saved device-light content is rejected before connection or dispatch',async()=>{
  const f=fixture();f.preferences.save('device.light-recipe.v1',JSON.stringify({version:1,name:'Unsafe',frames:[{atMs:0,controls:Array(8).fill(0),transitionMs:80,audio:1609}]}));
  await assert.rejects(f.runtime.execute('protocol.run',{protocol_id:'protocol-device-lights'}),/unsupported/);assert.equal(f.opens,0);assert.equal(f.written.length,0);await f.runtime.dispose();
});

test('another runtime cannot acquire a live droid owned by this runtime',async()=>{
  const f=fixture();const second=createDroidRuntime({id:'test',name:'R2',factory:f.factory,preferences:f.preferences});
  try{await f.runtime.connect();await assert.rejects(second.connect(),/runtime owner/);assert.equal(f.opens,1);assert.equal(f.closes,0);}finally{await second.dispose();await f.runtime.dispose();}
});

test('concurrent explicit connects cannot create duplicate transport sessions',async()=>{
  const f=fixture();try{const first=f.runtime.connect();await assert.rejects(f.runtime.connect(),/progress/);await first;assert.equal(f.opens,1);}finally{await f.runtime.dispose();}
});

test('disconnect finishes only after the confirmed-sleep transport close resolves',async()=>{
  const f=fixture();let finishClose!:()=>void;f.setClose(()=>new Promise<void>(resolve=>{finishClose=resolve;}));
  try{await f.runtime.connect();let finished=false;const disconnect=f.runtime.disconnect().then(()=>{finished=true;});
    for(let i=0;i<100;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.closes,1);assert.equal(finished,false);finishClose();await disconnect;
  }finally{finishClose?.();await f.runtime.dispose();}
});

test('STOP cancels a pending factory open and a late transport cannot become ready',async()=>{
  const f=fixture('source');let release!:()=>void,opened!:()=>void;
  const started=new Promise<void>(resolve=>{opened=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const runtime=createDroidRuntime({id:'pending-connect',name:'R2',preferences:f.preferences,factory:{open:async()=>{opened();await gate;return f.factory.open();}}});
  const states:string[]=[];const detach=runtime.subscribe(snapshot=>states.push(snapshot.state));
  const opening=runtime.connect();const outcome=opening.then(()=>null,error=>error);
  try{await started;await runtime.stop();release();assert.match(String(await outcome),/cancel/i);assert.equal(states.includes('ready'),false);assert.equal(runtime.snapshot().connection.state,'disconnected');assert.equal(f.closes,1);}
  finally{release();detach();await runtime.dispose();await f.runtime.dispose();}
});

test('STOP immediately after Connect revokes intent even before scanning is published',async()=>{
  const f=fixture();const opening=f.runtime.connect().then(()=>null,error=>error);
  try{await f.runtime.stop();assert.match(String(await opening),/cancel/i);assert.equal(f.runtime.snapshot().state,'disconnected');assert.equal(f.opens,0);}finally{await f.runtime.dispose();}
});

test('disposing during factory open cancels initialization and closes the late transport', async () => {
  const f = fixture('dispose-source');
  let release!: () => void;
  let opened!: () => void;
  let closing!: () => void;
  let finishClose!: () => void;
  const started = new Promise<void>(resolve => { opened = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const closeStarted = new Promise<void>(resolve => { closing = resolve; });
  const closeGate = new Promise<void>(resolve => { finishClose = resolve; });
  f.setClose(async () => {
    closing();
    await closeGate;
  });
  const runtime = createDroidRuntime({
    id: 'dispose-pending', name: 'R2', preferences: f.preferences,
    factory: {
      open: async () => {
        opened();
        await gate;
        return f.factory.open();
      },
    },
  });
  const states: string[] = [];
  const detach = runtime.subscribe(snapshot => states.push(snapshot.state));
  const opening = runtime.connect().then(() => null, error => error);
  const contender = createDroidRuntime({
    id: 'dispose-pending', name: 'R2', preferences: f.preferences, factory: f.factory,
  });
  try {
    await started;
    const disposal = runtime.dispose();
    assert.equal(runtime.dispose(), disposal, 'repeated disposal must share the cleanup wait');
    await assert.rejects(runtime.connect(), /disposed/i);
    release();
    await closeStarted;
    let finished = false;
    void disposal.then(() => { finished = true; });
    await new Promise(setImmediate);
    assert.equal(finished, false, 'disposal must wait for late transport teardown');
    await assert.rejects(contender.connect(), /runtime owner/i);
    finishClose();
    await disposal;
    assert.match(String(await opening), /cancel/i);
    assert.equal(states.includes('ready'), false);
    assert.equal(f.written.length, 0, 'a disposed runtime must not initialize late hardware');
    assert.equal(f.closes, 1, 'the late factory result must be closed');
    assert.equal(runtime.snapshot().connection.state, 'disconnected');
  } finally {
    release();
    finishClose();
    detach();
    await runtime.dispose();
    await contender.dispose();
    await f.runtime.dispose();
  }
});

test('admission prepares an immutable saved-light revision before connection or replacement waits',async()=>{
  const f=fixture();const save=(brightness:number)=>f.preferences.save('lightPresets.v1',JSON.stringify({version:1,presets:[{id:'saved',name:'Saved',values:[brightness,0,0,0,0,0,0,0],selected:[true,false,false,false,false,false,false,false]}]}));
  save(11);const prepared=f.runtime.prepare('lights.apply',{preset_id:'saved'});assert.equal(f.opens,0);
  save(99);try{await f.runtime.connect();await f.runtime.stop();await prepared.execute();assert.deepEqual([...f.written.at(-1)!.data],[0,1,11]);
    assert.deepEqual(prepared.parameters,{preset_id:'saved',resolved_settings:{front_dome_red:11}});
  }finally{await f.runtime.dispose();}
});

test('prepared protocol captures its validated frames and its audit parameters are detached',async()=>{
  const f=fixture();const prepared=f.runtime.prepare('protocol.run',{protocol_id:'protocol-device-lights'});
  const before=JSON.stringify(prepared.parameters);f.preferences.save('device.light-recipe.v1','invalid JSON');assert.equal(JSON.stringify(prepared.parameters),before);
  assert.equal(f.opens,0);await f.runtime.dispose();
});
