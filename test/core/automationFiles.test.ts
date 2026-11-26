import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRecipeFile,chooseRecipeFile,saveReviewedRecipeFile} from '../../core/automationFiles.ts';
const original={version:1,name:'Native greeting',steps:[{id:'dome',atMs:0,durationMs:1000,action:{type:'head',degrees:0}}]};
test('native file import validates a detached review without saving or executing',async()=>{
 let reads=0;const review=await chooseRecipeFile(async()=>{reads++;return JSON.stringify(original);});assert.equal(reads,1);assert.deepEqual(review.recipe,original);assert.equal(JSON.parse(review.text).name,original.name);assert.equal(review.steps,1);original.name='Changed after review';assert.equal(review.recipe.name,'Native greeting');
});
test('explicit save exports only the reviewed validated snapshot through the native picker',async()=>{
 const review=reviewRecipeFile(JSON.stringify({...original,name:'Saved greeting'}));const writes:any[]=[];await saveReviewedRecipeFile(review,async(name,text)=>{writes.push({name,text});});assert.equal(writes.length,1);assert.equal(writes[0].name,'r2-recipe.json');assert.equal(JSON.parse(writes[0].text).name,'Saved greeting');
});
test('invalid, oversized and unsupported native imports fail before review or save',async()=>{
 for(const text of ['not JSON',' '.repeat(200001),JSON.stringify({...original,version:2}),JSON.stringify({...original,steps:[{id:'bad',atMs:0,durationMs:100,action:{type:'upload',data:[1]}}]})])await assert.rejects(chooseRecipeFile(async()=>text));
 let writes=0;await assert.rejects(saveReviewedRecipeFile({recipe:original,text:'invalid',steps:0},async()=>{writes++;}));assert.equal(writes,0);
});
test('picker cancellation is propagated and does not produce a review or a successful save',async()=>{
 await assert.rejects(chooseRecipeFile(async()=>{throw new Error('Picker canceled');}),/canceled/);await assert.rejects(saveReviewedRecipeFile(reviewRecipeFile(JSON.stringify(original)),async()=>{throw new Error('Save canceled');}),/canceled/);
});
