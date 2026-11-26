import test from 'node:test';
import assert from 'node:assert/strict';
import {readSavedRecipes, saveSavedRecipe} from '../../app/workshop/savedRecipes.ts';

const valid = {version: 1 as const, name: 'Greeting', steps: []};
function stored(raw: string | null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set('automation.recipes.v1', raw);
  return {
    values,
    loadPreference: (key: string) => values.get(key) ?? null,
    savePreference: (key: string, value: string) => { values.set(key, value); },
  };
}

test('one invalid saved protocol does not hide valid entries before or after it', () => {
  const port = stored(JSON.stringify([valid, {version: 1, name: 'Broken', steps: 'invalid'}, {...valid, name: 'Later'}]));
  const result = readSavedRecipes(port);
  assert.deepEqual(result.recipes.map(r => r.name), ['Greeting', 'Later']);
  assert.match(result.error ?? '', /entry 2/i);
  assert.match(result.error ?? '', /unchanged|preserved/i);
});

test('ordinary saves preserve the exact original bytes when any entry is invalid', async () => {
  const raw = '[\n {"version":1,"name":"Greeting","steps":[]},\n {"version":1,"name":"Broken","steps":"invalid"}\n]';
  const port = stored(raw);
  await assert.rejects(saveSavedRecipe(port, {...valid, name: 'New protocol'}), /saved protocol/i);
  assert.equal(port.values.get('automation.recipes.v1'), raw);
});

test('malformed JSON and non-array data are protected from replacement', async () => {
  for (const raw of ['{"unfinished":', '{"version":1}', 'null', '']) {
    const port = stored(raw);
    assert.ok(readSavedRecipes(port).error);
    await assert.rejects(saveSavedRecipe(port, valid));
    assert.equal(port.values.get('automation.recipes.v1'), raw);
  }
});

test('saves read the current collection so another panel cannot lose existing protocols', async () => {
  const port = stored(JSON.stringify([valid]));
  readSavedRecipes(port);
  port.values.set('automation.recipes.v1', JSON.stringify([valid, {...valid, name: 'Saved elsewhere'}]));
  const next = await saveSavedRecipe(port, {...valid, name: 'New protocol'});
  assert.deepEqual(next.map(r => r.name), ['Greeting', 'Saved elsewhere', 'New protocol']);
  assert.deepEqual(JSON.parse(port.values.get('automation.recipes.v1')!).map((r: {name:string}) => r.name), ['Greeting', 'Saved elsewhere', 'New protocol']);
});

test('missing storage allows first save and saving an existing name replaces only that entry', async () => {
  const port = stored(null);
  assert.deepEqual(readSavedRecipes(port), {recipes: []});
  await saveSavedRecipe(port, valid);
  await saveSavedRecipe(port, {...valid, name: 'Other'});
  const next = await saveSavedRecipe(port, {...valid, steps: [{id:'pause', atMs:0, durationMs:10, action:{type:'wait'}}]});
  assert.deepEqual(next.map(r => r.name), ['Other', 'Greeting']);
  assert.equal(next[1].steps[0].durationMs, 10);
});

test('preference read errors block writes instead of treating the collection as empty', async () => {
  let writes = 0;
  const port = {loadPreference: () => {throw new Error('Storage unavailable');}, savePreference: () => {writes++;}};
  assert.match(readSavedRecipes(port).error ?? '', /Storage unavailable/);
  await assert.rejects(saveSavedRecipe(port, valid), /Storage unavailable/);
  assert.equal(writes, 0);
});
