import test from 'node:test';
import assert from 'node:assert/strict';
import { rainbowCommand, RainbowAnimation } from '../../../app/library/rainbow.ts';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 let now=0;const timers=new Map<number,()=>void>();let next=0;const cancels=new Set<()=>void>();
 const sent:any[]=[];const snapshot:any={state:'ready',connectionEpoch:1,safety:{canControl:true}};
 let held:Promise<unknown>|undefined;
 const port={store:{getSnapshot:()=>snapshot},cancelLocalSources(){for(const cancel of [...cancels])cancel();},registerCancel(cancel:()=>void){cancels.add(cancel);return()=>cancels.delete(cancel);},async executeManual(command:any){sent.push(command);if(held)await held;}};
 const clock={now:()=>now,setTimeout(callback:()=>void,_ms:number){const id=++next;timers.set(id,callback);return id;},clearTimeout(id:number){timers.delete(id);}};
 const runner=new RainbowAnimation(port,()=>{},clock);
 return{runner,port,sent,snapshot,timers,hold(p:Promise<unknown>){held=p;},async advance(ms:number){now+=ms;const callbacks=[...timers.values()];timers.clear();for(const cb of callbacks)cb();await tick();}};
}
test('rainbow interpolates both domes and excludes fixed-color emitters',()=>{
 for(const [ms,rgb] of [[0,[255,0,0]],[1000,[255,255,0]],[2000,[0,255,0]],[3000,[0,255,255]],[4000,[0,0,255]],[5000,[255,0,255]],[6000,[255,0,0]]] as const){
  const c=rainbowCommand(ms);assert.equal(c.did,26);assert.equal(c.cid,14);assert.deepEqual([...c.data],[0,0x77,...rgb,...rgb]);
 }
 assert.deepEqual([...rainbowCommand(500).data],[0,0x77,255,128,0,255,128,0]);
});
test('rainbow repeats without catch-up frames until explicitly canceled',async()=>{
 const f=fixture();const done=f.runner.start();await tick();assert.equal(f.sent.length,1);
 await f.advance(3000);assert.equal(f.sent.length,2);await f.advance(3000);
 assert.equal(f.sent.length,3);assert.deepEqual([...f.sent[2].data],[...rainbowCommand(6000).data]);
 await f.advance(1000);assert.equal(f.sent.length,4);f.runner.cancel();await done;assert.equal(f.timers.size,0);
});
test('delayed acknowledgement cannot queue frames or revive a canceled run',async()=>{
 const f=fixture();let resolve!:()=>void;f.hold(new Promise<void>(r=>resolve=r));
 const done=f.runner.start();await tick();await f.advance(1000);assert.equal(f.sent.length,1);
 f.port.cancelLocalSources();resolve();await done;await f.advance(8000);assert.equal(f.sent.length,1);assert.equal(f.timers.size,0);
});
test('focus loss and a changed connection epoch stop without further writes',async()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.snapshot.safety.canControl=false;},(f:ReturnType<typeof fixture>)=>{f.snapshot.connectionEpoch=2;}]){
  const f=fixture();const done=f.runner.start();await tick();change(f);await f.advance(100);await done;assert.equal(f.sent.length,1);
 }
});
test('command failure stops without retries and rejects to the UI',async()=>{
 const f=fixture();f.hold(Promise.reject(Error('rejected')));await assert.rejects(f.runner.start(),/rejected/);assert.equal(f.sent.length,1);assert.equal(f.timers.size,0);
});

test('Rainbow is a client animation preset, not a firmware animation or cockpit slot',async()=>{
 const {libraryItem,searchLibrary}=await import('../../../app/library/catalog.ts');
 const {catalog}=await import('../../../service/catalogs.ts');
 const {pinSoundboard,defaultsHudPreferences}=await import('../../../app/library/preferences.ts');
 const item=libraryItem('lights:rainbow');assert.equal(item?.lightEffect,'rainbow');
 assert.equal(searchLibrary({kind:'animations',category:'Lights',query:'rainbow',favorites:[],favoritesOnly:false}).length,1);
 assert.ok(!catalog('animations',{load:()=>null,save:()=>{}}).items.some(item=>item.id==='lights:rainbow'));
 assert.throws(()=>pinSoundboard(defaultsHudPreferences(),0,'lights:rainbow'));
});
