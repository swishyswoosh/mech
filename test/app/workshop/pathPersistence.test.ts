import test from 'node:test';
import assert from 'node:assert/strict';
import {readPathEditor, serializePathEditor} from '../../../app/workshop/pathPersistence.ts';
import {parsePathDraft} from '../../../core/automation.ts';
const path = {version: 1 as const, units: 'preview' as const, points: [{x: 1, y: 2}, {x: 3, y: 4}], speedPercent: 30, startOrientation: 90};
const reader = (route: string | null, spacing: string | null = null) => ({loadPreference: (key: string) => key === 'automation.path.v1' ? route : spacing});

test('legacy points and version-1 paths retain route and separate drawing spacing without rewriting bytes', () => {
  const legacy = JSON.stringify(path.points);
  const spacing = ' 3.5 ';
  const storage = reader(legacy, spacing);
  const loaded = readPathEditor(storage);
  assert.deepEqual(loaded.draft, {...path, speedPercent: 25, startOrientation: 0});
  assert.equal(loaded.spacing, '3.5');
  assert.equal(storage.loadPreference('automation.path.v1'), legacy);
  assert.equal(storage.loadPreference('automation.path.spacing.v1'), spacing);
  assert.deepEqual(readPathEditor(reader(JSON.stringify(path), '4')), {draft: path, spacing: '4'});
});

test('combined saved editor survives reload and remains a portable version-1 path', () => {
  const text = serializePathEditor(path, '5');
  const loaded = readPathEditor({loadPreference(key) {
    if (key !== 'automation.path.v1') throw Error('obsolete spacing must not be read');
    return text;
  }});
  assert.deepEqual(loaded, {draft: path, spacing: '5'});
  assert.equal(parsePathDraft(text).speedPercent, 30);
  assert.equal(Object.hasOwn(loaded.draft, 'editor'), false, 'local metadata must not leak into ordinary exports');
});

test('corrupt or unreadable legacy settings fail strictly instead of silently replacing saved data', () => {
  for (const route of ['', '{bad', 'null', '{}', JSON.stringify({...path, points: [null]})])
    assert.throws(() => readPathEditor(reader(route)));
  for (const spacing of ['', ' ', 'NaN', '0', '101'])
    assert.throws(() => readPathEditor(reader(JSON.stringify(path), spacing)));
  assert.throws(() => readPathEditor({loadPreference() {throw Error('read denied');}}), /read denied/);
  assert.throws(() => readPathEditor(reader(JSON.stringify({...path, editor: {version: 2, drawingSpacing: 2}}))), /Unsupported/);
  for (const spacing of [null, '4', 0, 101])
    assert.throws(() => readPathEditor(reader(JSON.stringify({...path, editor: {version: 1, drawingSpacing: spacing}}))));
});

test('missing documents default safely and invalid current drafts cannot be serialized for save', () => {
  assert.deepEqual(readPathEditor(reader(null)), {draft: {version: 1, units: 'preview', points: [], speedPercent: 25, startOrientation: 0}, spacing: '2'});
  for (const spacing of ['', ' ', 'NaN', '.1', '101'])
    assert.throws(() => serializePathEditor(path, spacing));
  assert.throws(() => serializePathEditor({...path, speedPercent: 101}, '2'));
});
