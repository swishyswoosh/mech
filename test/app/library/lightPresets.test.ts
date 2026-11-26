import test from 'node:test';
import assert from 'node:assert/strict';
import {readLightPresets,saveLightPreset,deleteLightPreset,LIGHT_PRESETS_KEY} from '../../../app/library/lightPresets.ts';
import {lightPreset,selectedLightCommand} from '../../../app/library/lights.ts';
const selected=[true,true,true,false,false,false,true,false];
const draft=(name='Evening')=>({name,values:lightPreset('Idle'),selected:[...selected]});
const read=(entries:Record<string,string>)=>readLightPresets(key=>entries[key]??null);
test('legacy preset is preserved, converted to numeric values, and not resurrected after deletion',()=>{
 const old={lightPreset:JSON.stringify({values:lightPreset('Idle').map(String),selected}),lightPresetName:'Evening'};
 const first=read(old);assert.equal(first.error,undefined);assert.equal(first.presets.length,1);
 assert.deepEqual(first.presets[0].values,lightPreset('Idle'));assert.deepEqual(first.presets[0].selected,selected);
 assert.equal(first.presets[0].name,'Evening');
 const removed=deleteLightPreset(first.presets,first.presets[0].id);
 assert.deepEqual(read({...old,[LIGHT_PRESETS_KEY]:JSON.stringify({version:1,presets:removed})}).presets,[]);
});
test('multiple named presets round-trip, updating one preserves the other and their masks',()=>{
 const one=saveLightPreset([],draft());const two=saveLightPreset(one.presets,{...draft('Alert room'),values:lightPreset('Alert')});
 assert.equal(two.presets.length,2);
 const changed=saveLightPreset(two.presets,{...draft('Evening dim'),values:lightPreset('Off')},one.saved.id);
 assert.equal(changed.presets.length,2);assert.deepEqual(changed.presets[1],two.saved);
 const loaded=read({[LIGHT_PRESETS_KEY]:JSON.stringify({version:1,presets:changed.presets})});
 assert.deepEqual(loaded.presets,changed.presets);
 assert.deepEqual(selectedLightCommand(loaded.presets[1].values,loaded.presets[1].selected),selectedLightCommand(lightPreset('Alert'),selected));
 const deleted=deleteLightPreset(loaded.presets,one.saved.id);assert.deepEqual(deleted,[two.saved]);
});
test('empty/duplicate names and invalid channel data cannot overwrite valid presets',()=>{
 const one=saveLightPreset([],draft());
 assert.throws(()=>saveLightPreset(one.presets,draft(' evening ')),/already exists/i);
 assert.throws(()=>saveLightPreset(one.presets,draft('  ')),/name/i);
 assert.throws(()=>saveLightPreset(one.presets,{...draft('Bad'),selected:Array(8).fill(false)}),/channel/i);
 assert.throws(()=>saveLightPreset(one.presets,{...draft('Bad'),selected:[true]}),/channel/i);
 assert.throws(()=>saveLightPreset(one.presets,{...draft('Bad'),values:[256]}),/channel/i);
 assert.throws(()=>saveLightPreset(one.presets,draft('Missing'),'missing'),/not found/i);
 assert.equal(one.presets[0].name,'Evening');
});
test('corrupt or future saved data reports an error instead of falling back and overwriting it',()=>{
 for(const text of ['{',JSON.stringify({version:99,presets:[]}),JSON.stringify({version:1,presets:[{...draft(),id:'x',selected:[1]}]})]){
  const result=read({[LIGHT_PRESETS_KEY]:text});assert.ok(result.error);assert.deepEqual(result.presets,[]);
 }
 assert.ok(read({lightPreset:'{'}).error);
});
