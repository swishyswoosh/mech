import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createBluezFactory} from '../../service/bluezTransport.ts';
const config={address:'AA:BB:CC:DD:EE:FF',droidId:'r2',adapter:'hci1',pythonCommand:process.execPath,pythonArgs:[fileURLToPath(new URL('./bluezFake.mjs',import.meta.url))]};
test('BlueZ routes enrolled address and adapter over private IPC without ESP credentials',async()=>{
 const factory=createBluezFactory(config);
 assert.deepEqual(await factory.authorizedDroids!(),[{id:'r2',name:'R2-D2'}]);
 const {transport}=await factory.open({services:['service-one'],check(){},selection(){},onDisconnect(){}});
 assert.deepEqual(await transport.read({service:'service-one',characteristic:'char-one'}),Uint8Array.of(0,255,128));
 await transport.disconnect();
});
test('BlueZ rejects invalid enrollment, adapter and deadlines before process startup',()=>{
 for(const value of [{address:'invalid'},{adapter:'../hci0'},{requestTimeoutMs:0},{connectTimeoutMs:Infinity},{droidId:''}])assert.throws(()=>createBluezFactory({...config,...value}),/invalid/i);
});
test('canceled child retains ownership until graceful Bluetooth cleanup finishes',async()=>{
 const {mkdtempSync,existsSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'mech-cleanup-'));const marker=join(dir,'closed');
 const factory=createBluezFactory({...config,pythonArgs:[fileURLToPath(new URL('./gattCleanupFake.mjs',import.meta.url)),marker]});
 const request={services:[],check(){},selection(){},onDisconnect(){}};
 try{
  const {transport}=await factory.open(request);factory.cancel!();
  await assert.rejects(factory.open(request),/active/i);
  await transport.disconnect();
  assert.equal(existsSync(marker),true,'child must finish cleanup before releasing owner');
  assert.equal(readFileSync(marker,'utf8'),'closed');
  const next=await factory.open(request);await next.transport.disconnect();
 }finally{factory.cancel!();rmSync(dir,{force:true,recursive:true});}
});
