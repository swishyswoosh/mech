import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OperationStore} from '../../service/store.ts';
test('operation acceptance is durable, keys detect altered payloads and restart never replays',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mech-store-'));const path=join(dir,'state.sqlite');
 try {let s=new OperationStore(path);const a=s.accept('alice','key','r2',{action:'sound.play',parameters:{sound_id:'hey'}});assert.equal(a.created,true);assert.equal(s.accept('alice','key','r2',{action:'sound.play',parameters:{sound_id:'hey'}}).operation.operation_id,a.operation.operation_id);assert.throws(()=>s.accept('alice','key','r2',{action:'sound.play',parameters:{sound_id:'sad'}}),/conflict/);s.close();s=new OperationStore(path);assert.equal(s.get(a.operation.operation_id)?.state,'interrupted');assert.equal(s.accept('alice','key','r2',{action:'sound.play',parameters:{sound_id:'hey'}}).created,false);s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('preferences use durable revisions and reject stale writers',()=>{
 const s=new OperationStore(':memory:');assert.deepEqual(s.preferences('r2'),{revision:0,values:{}});assert.equal(s.savePreferences('r2',0,{name:'Artoo'}).revision,1);assert.throws(()=>s.savePreferences('r2',0,{name:'stale'}),/revision/);assert.equal(s.preferences('r2').values.name,'Artoo');s.close();
});
test('token revocations survive service restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mech-revocation-')),path=join(dir,'state.sqlite');try{let s=new OperationStore(path);s.revokeToken('ha');s.close();s=new OperationStore(path);assert.deepEqual(s.revokedTokens(),['ha']);s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
