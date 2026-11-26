import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryPage } from '../../../app/library/libraryPage.ts';
const items=Array.from({length:14},(_,i)=>({key:`item:${i}`}));
test('bounded pages expose the whole catalog without a long document',()=>{
 assert.deepEqual([0,1,2].flatMap(page=>libraryPage(items,page).items),items);
 assert.equal(libraryPage(items,1).items.length,6);
 assert.equal(libraryPage(items,99).page,2);
 assert.equal(libraryPage(items,-1).page,0);
});
test('selection stays on the current filtered page and empty results have no action target',()=>{
 assert.equal(libraryPage(items,1,'item:8').selected?.key,'item:8');
 assert.equal(libraryPage(items,1,'item:1').selected?.key,'item:6');
 assert.equal(libraryPage(items.slice(0,2),2,'item:8').selected?.key,'item:0');
 assert.deepEqual(libraryPage([],2,'item:8'),{items:[],page:0,pages:0,selected:undefined});
});


test('three-row native pages expose nine choices and retain selection across page boundaries',()=>{
 const source=Array.from({length:20},(_,i)=>({key:`item:${i}`}));
 assert.deepEqual([0,1,2].flatMap(page=>libraryPage(source,page,undefined,9).items),source);
 assert.equal(libraryPage(source,0,undefined,9).items.length,9);
 assert.equal(libraryPage(source,1,'item:10',9).selected?.key,'item:10');
 assert.equal(libraryPage(source,1,'item:8',9).selected?.key,'item:9');
 assert.equal(libraryPage(source,99,undefined,9).items.length,2);
});
