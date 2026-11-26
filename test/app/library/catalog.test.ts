import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryItems,searchLibrary} from '../../../app/library/catalog.ts';
const group=(category:string,kind:'sounds'|'animations'='sounds')=>searchLibrary({kind,category,query:'',favorites:[],favoritesOnly:false});
test('shared prefixes group all numbered sound families, including space-prefixed source names',()=>{
 assert.deepEqual(group('Hit').map(i=>i.name),Array.from({length:11},(_,i)=>`Hit ${i+1}`));
 assert.equal(group('Step').length,6);
 assert.deepEqual(group('Scream').map(i=>i.name),['Scream','Scream 2']);
 assert.equal(group('Chatty').length,62);
 assert.deepEqual(group('Chatty').slice(0,3).map(i=>i.name),['Chatty 1','Chatty 2','Chatty 3']);
 assert.ok(group('Effects').some(i=>i.name==='Engage Hyperdrive'));
 assert.ok(group('Effects').every(i=>!/^Hit|^Step|^Scream/.test(i.name)));
});
test('animation charger family is separate from idle while stable sound IDs and favorites survive grouping',()=>{
 assert.equal(group('Charger','animations').length,7);
 assert.equal(group('Idle','animations').length,3);
 const hit=group('Hit')[1];assert.equal(hit.key,'sound:27');assert.equal(hit.sector,1642);
 assert.deepEqual(searchLibrary({kind:'sounds',category:'Hit',query:'2',favorites:[hit.key],favoritesOnly:true}),[hit]);
 assert.equal(libraryItems.filter(i=>i.kind==='sound').length,212);
});
