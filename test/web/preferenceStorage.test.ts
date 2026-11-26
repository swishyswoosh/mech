import test from 'node:test';
import assert from 'node:assert/strict';
import {WebPort} from '../../web/port.ts';
import {loadSettings, saveSettings} from '../../app/library/settings.ts';

function withStorage(run: (storage: {values: Map<string, string>; blockReads: boolean; writes: string[]}) => void | Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = {values: new Map<string, string>(), blockReads: false, writes: [] as string[]};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem(key: string) {
      if (storage.blockReads) throw Error('Injected localStorage read denial');
      return storage.values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.writes.push(key);
      storage.values.set(key, value);
    }
  }});
  return Promise.resolve().then(() => run(storage)).finally(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
}

test('actual browser port exposes unreadable settings and refuses replacement without losing original bytes', () => withStorage(async storage => {
  storage.values.set('r2.controllerSettings', '{original unreadable settings bytes');
  storage.blockReads = true;
  const port = new WebPort();
  const settings = loadSettings(port);
  assert.match(settings.error ?? '', /Injected localStorage read denial/);
  await assert.rejects(async () => saveSettings(port, settings), /Saving is blocked/);
  assert.equal(storage.values.get('r2.controllerSettings'), '{original unreadable settings bytes');
  assert.deepEqual(storage.writes, []);
}));

test('actual browser port cannot overwrite an optional preference while its current bytes cannot be read', () => withStorage(async storage => {
  const port = new WebPort();
  storage.values.set('r2.droidName.v1.test', 'Retained name');
  storage.blockReads = true;
  await assert.rejects(async () => port.savePreference('droidName.v1.test', 'Replacement'), /Injected localStorage read denial/);
  assert.equal(storage.values.get('r2.droidName.v1.test'), 'Retained name');
  assert.deepEqual(storage.writes, []);
}));

test('actual browser port retains namespaced preference reads and acknowledged writes when storage is available', () => withStorage(async storage => {
  storage.values.set('r2.hudIntensity', 'off');
  const port = new WebPort();
  assert.equal(port.loadPreference('hudIntensity'), 'off');
  await port.savePreference('hudIntensity', 'on');
  assert.equal(port.loadPreference('hudIntensity'), 'on');
  assert.deepEqual(storage.writes, ['r2.hudIntensity']);
}));
