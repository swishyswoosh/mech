import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createEspHomeFactory} from '../../service/espHomeTransport.ts';
const ref={service:'service-one',characteristic:'char-one'};
const config={host:'proxy.invalid',encryptionKey:Buffer.alloc(32,1).toString('base64'),address:'AA:BB:CC:DD:EE:FF',droidId:'r2',pythonCommand:process.execPath,pythonArgs:[fileURLToPath(new URL('./espHomeFake.mjs',import.meta.url))],requestTimeoutMs:100,connectTimeoutMs:500};
const request=(onDisconnect=()=>{})=>({services:['service-one'],check(){},selection(){},onDisconnect});
test('factory does not start process until explicit open; preserves bytes, service and response mode',async()=>{
 const factory=createEspHomeFactory(config);assert.deepEqual(await factory.authorizedDroids!(),[{id:'r2',name:'R2-D2'}]);
 const {transport}=await factory.open(request());assert.deepEqual(await transport.discover(),[ref]);
 assert.deepEqual(await transport.read(ref),Uint8Array.of(0,255,128));
 await transport.write(ref,Uint8Array.of(0,255,128),false);
 const values:number[][]=[];const unsub=await transport.subscribe(ref,data=>values.push([...data]));
 await transport.write(ref,Uint8Array.of(1),true);assert.deepEqual(values,[[9,255]]);unsub();
 await transport.disconnect();await assert.rejects(transport.read(ref),/closed/i);
});
test('wrong enrollment cannot open and concurrent ownership fails',async()=>{
 const factory=createEspHomeFactory(config);await assert.rejects(factory.open({...request(),authorizedId:'other'}),/enrolled/i);
 const {transport}=await factory.open(request());await assert.rejects(factory.open(request()),/active/i);await transport.disconnect();
});
test('request timeout invalidates connection, rejects queued work, and never replays',async()=>{
 let losses=0;const factory=createEspHomeFactory(config);const {transport}=await factory.open(request(()=>losses++));
 const write=transport.write(ref,Uint8Array.of(99),true);const queued=transport.read(ref);
 await assert.rejects(write,/timed out/i);await assert.rejects(queued,/closed/i);assert.equal(losses,1);await transport.disconnect();
 const second=await factory.open(request());assert.deepEqual(await second.transport.read(ref),Uint8Array.of(0,255,128));await second.transport.disconnect();
});
test('stale event epochs ignored and loss cancels pending reads',async()=>{
 let losses=0;const {transport}=await createEspHomeFactory(config).open(request(()=>losses++));
 let calls=0;await transport.subscribe(ref,()=>calls++);await transport.write(ref,Uint8Array.of(98),true);assert.equal(calls,0);
 await assert.rejects(transport.write(ref,Uint8Array.of(97),true),/lost/i);assert.equal(losses,1);
});

test('reserved all-zero encryption key is rejected before opening a child',()=>{assert.throws(()=>createEspHomeFactory({...config,encryptionKey:Buffer.alloc(32).toString('base64')}),/configuration/i);});
test('STOP bypasses full queue, cancels unsent writes and chunks frames in order',async t=>{
 const {transport}=await createEspHomeFactory({...config,requestTimeoutMs:1000}).open(request());
 t.after(()=>transport.disconnect());
 let notifications=0;await transport.subscribe(ref,()=>notifications++);
 const first=transport.write(ref,Uint8Array.of(96),true);
 // Start one ATT write, then saturate the local queue before STOP.
 await new Promise(resolve=>setTimeout(resolve,10));
 const canceled=Array.from({length:63},()=>transport.write(ref,Uint8Array.of(2),true).then(()=>false,()=>true));
 const stop=transport.emergencyWrite!(ref,[new Uint8Array(41).fill(3)]);
 await Promise.all([first,stop]);assert.ok((await Promise.all(canceled)).every(Boolean));assert.equal(notifications,4);
 await transport.disconnect();
});
test('sidecar receives credentials through private IPC without inheriting service credential environment',async()=>{
 const previous=process.env.ESP_TEST_CREDENTIAL;
 process.env.ESP_TEST_CREDENTIAL=config.encryptionKey;
 try{const {transport}=await createEspHomeFactory(config).open(request());await transport.disconnect();}
 finally{if(previous===undefined)delete process.env.ESP_TEST_CREDENTIAL;else process.env.ESP_TEST_CREDENTIAL=previous;}
});
