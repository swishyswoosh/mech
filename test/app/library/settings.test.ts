import test from "node:test";
import assert from "node:assert/strict";
import { loadPreferences } from "../../../app/preferences.ts";
import { loadInterface } from "../../../app/library/interfacePreferences.ts";
import { loadSettings, saveInterfacePreferences, saveSettings } from "../../../app/library/settings.ts";
import {
  defaultsHudPreferences,
  loadHudPreferences,
  saveHudPreferences,
} from "../../../app/library/preferences.ts";

function store(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  const writes: string[] = [];
  return {
    data,
    writes,
    loadPreference: (key: string) => data.get(key) ?? null,
    savePreference: (key: string, value: string) => {
      writes.push(key);
      data.set(key, value);
    },
  };
}

test("all interface entry points preserve System appearance and share defaults", () => {
  for (const value of [null, JSON.stringify({ theme: "system", defaultSpeed: 37, largeLabels: true }), '{"theme":"unknown","defaultSpeed":37,"largeLabels":true}']) {
    const session = store(value === null ? {} : { interfacePreferences: value });
    assert.deepEqual(loadInterface(session), loadPreferences(value));
  }
});

test("an individual HUD save migrates legacy interface values into the same atomic record", async () => {
  const session = store({
    interfacePreferences: JSON.stringify({ theme: "system", defaultSpeed: 37, largeLabels: true }),
  });
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [12, 34, 56];
  await saveHudPreferences(session, hud);
  assert.deepEqual(session.writes, ["controllerSettings"]);
  const saved = JSON.parse(session.data.get("controllerSettings")!);
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.hud.gearSpeeds, [12, 34, 56]);
  assert.deepEqual(saved.interface, { theme: "system", defaultSpeed: 37, largeLabels: true });
});

test("HUD and interface readers use the canonical record ahead of stale legacy keys", () => {
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [12, 34, 56];
  const session = store({
    controllerSettings: JSON.stringify({ version: 1, hud, interface: { theme: "light", defaultSpeed: 37, largeLabels: true } }),
    cockpitPreferences: JSON.stringify(defaultsHudPreferences()),
    interfacePreferences: JSON.stringify({ theme: "dark", defaultSpeed: 25, largeLabels: false }),
  });
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [12, 34, 56]);
  assert.deepEqual(loadInterface(session), { theme: "light", defaultSpeed: 37, largeLabels: true });
});

test("an unrecognized canonical document blocks an individual save without losing its bytes", async () => {
  const original = '{"version":2,"futureSettings":{"keep":true}}';
  const session = store({ controllerSettings: original });
  await assert.rejects(async () => saveHudPreferences(session, defaultsHudPreferences()), /settings|version/i);
  assert.equal(session.data.get("controllerSettings"), original);
  assert.deepEqual(session.writes, []);
});

test("a theme save preserves HUD choices and subsequent HUD changes preserve the interface", async () => {
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [12, 34, 56];
  hud.soundboard[3] = "sound:42";
  const session = store({ cockpitPreferences: JSON.stringify(hud) });
  await saveInterfacePreferences(session, { theme: "light", defaultSpeed: 37, largeLabels: true });
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [12, 34, 56]);
  assert.equal(loadHudPreferences(session).soundboard[3], "sound:42");
  await saveHudPreferences(session, { ...loadHudPreferences(session), gear: 2 });
  assert.deepEqual(loadInterface(session), { theme: "light", defaultSpeed: 37, largeLabels: true });
  assert.equal(loadHudPreferences(session).gear, 2);
});

test("one confirmed save applies the complete settings draft", async () => {
  const session = store();
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [12, 34, 56];
  await saveSettings(session, { hud, interface: { theme: "system", defaultSpeed: 37, largeLabels: true } });
  assert.deepEqual(session.writes, ["controllerSettings"]);
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [12, 34, 56]);
  assert.deepEqual(loadInterface(session), { theme: "system", defaultSpeed: 37, largeLabels: true });
});

test("a rejected combined save leaves both saved halves intact", async () => {
  const session = store();
  await saveSettings(session, { hud: defaultsHudPreferences(), interface: { theme: "dark", defaultSpeed: 25, largeLabels: false } });
  const original = session.data.get("controllerSettings");
  const rejectingStore = {
    loadPreference: session.loadPreference,
    savePreference: async () => { throw Error("Service rejected preferences"); },
  };
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [12, 34, 56];
  await assert.rejects(async () => saveSettings(rejectingStore, { hud, interface: { theme: "light", defaultSpeed: 37, largeLabels: true } }), /Service rejected/);
  assert.equal(session.data.get("controllerSettings"), original);
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [25, 50, 100]);
  assert.deepEqual(loadInterface(session), { theme: "dark", defaultSpeed: 25, largeLabels: false });
});

test("invalid interface draft rejects before any HUD part is persisted", async () => {
  const session = store();
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [12, 34, 56];
  await assert.rejects(async () => saveSettings(session, { hud, interface: { theme: "dark", defaultSpeed: 101, largeLabels: false } }), /speed/i);
  assert.deepEqual(session.writes, []);
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [25, 50, 100]);
});

test("invalid canonical settings remain readable as safe defaults with a visible error and cannot overwrite legacy values", async () => {
  const legacyHud = defaultsHudPreferences();
  legacyHud.gearSpeeds = [12, 34, 56];
  for (const original of ["{broken", '{"version":1,"hud":null,"interface":null}', '{"version":1,"hud":{},"interface":{"theme":"light","defaultSpeed":37,"largeLabels":true}}']) {
    const session = store({ controllerSettings: original, cockpitPreferences: JSON.stringify(legacyHud), interfacePreferences: JSON.stringify({ theme: "light", defaultSpeed: 37, largeLabels: true }) });
    assert.match(loadSettings(session).error ?? "", /invalid|unsupported/);
    assert.deepEqual(loadHudPreferences(session).gearSpeeds, [25, 50, 100]);
    assert.deepEqual(loadInterface(session), { theme: "system", defaultSpeed: 25, largeLabels: false });
    await assert.rejects(async () => saveInterfacePreferences(session, { theme: "dark", defaultSpeed: 25, largeLabels: false }), /Saving is blocked/);
    assert.equal(session.data.get("controllerSettings"), original);
    assert.deepEqual(session.writes, []);
  }
});

test("storage read failures keep optional settings safe and block writes", async () => {
  for (const failingKey of ["controllerSettings", "cockpitPreferences", "interfacePreferences"]) {
    const session = store();
    session.loadPreference = (key: string) => {
      if (key === failingKey) throw Error("Storage unavailable");
      return null;
    };
    assert.match(loadSettings(session).error ?? "", /Storage unavailable/);
    assert.deepEqual(loadHudPreferences(session).gearSpeeds, [25, 50, 100]);
    assert.deepEqual(loadInterface(session), { theme: "system", defaultSpeed: 25, largeLabels: false });
    await assert.rejects(async () => saveHudPreferences(session, defaultsHudPreferences()), /Saving is blocked/);
    assert.deepEqual(session.writes, []);
  }
});

test("malformed or invalid present legacy values block canonical migration without losing their bytes", async () => {
  const cases = [
    ["cockpitPreferences", "{broken"],
    ["cockpitPreferences", "null"],
    ["cockpitPreferences", "[]"],
    ["cockpitPreferences", '{"gearSpeeds":[12,101,56]}'],
    ["interfacePreferences", "{broken"],
    ["interfacePreferences", "null"],
    ["interfacePreferences", '{"theme":"unknown","defaultSpeed":37,"largeLabels":true}'],
    ["interfacePreferences", '{"theme":"light","defaultSpeed":101,"largeLabels":true}'],
  ];
  for (const [key, original] of cases) {
    const session = store({ [key]: original });
    assert.match(loadSettings(session).error ?? "", /invalid|unsupported/);
    assert.deepEqual(loadHudPreferences(session).gearSpeeds, [25, 50, 100]);
    assert.deepEqual(loadInterface(session), { theme: "system", defaultSpeed: 25, largeLabels: false });
    await assert.rejects(async () => saveSettings(session, { hud: defaultsHudPreferences(), interface: { theme: "dark", defaultSpeed: 25, largeLabels: false } }), /Saving is blocked/);
    assert.equal(session.data.get(key), original);
    assert.equal(session.data.has("controllerSettings"), false);
    assert.deepEqual(session.writes, []);
  }
});

test("valid legacy eight-slot preferences migrate to the atomic document without losing custom choices", async () => {
  const old: any = defaultsHudPreferences();
  old.gear = 2;
  old.gearSpeeds = [12, 34, 56];
  old.soundboard = old.soundboard.slice(0, 8);
  old.soundboard[0] = "sound:42";
  old.input.keys.driveUp = "Digit9";
  delete old.input.keys.slot9;
  delete old.input.gamepad.slot9;
  const session = store({ cockpitPreferences: JSON.stringify(old) });
  const migrated = loadSettings(session);
  assert.equal(migrated.error, undefined);
  assert.deepEqual(migrated.hud.gearSpeeds, [12, 34, 56]);
  assert.equal(migrated.hud.soundboard[0], "sound:42");
  assert.equal(migrated.hud.soundboard[8], "animation:13");
  assert.equal(migrated.hud.input.keys.driveUp, "Digit9");
  assert.equal(migrated.hud.input.keys.slot9, "Digit0");
  assert.equal(migrated.hud.input.gamepad.slot9, -1);
  await saveInterfacePreferences(session, { theme: "light", defaultSpeed: 37, largeLabels: true });
  assert.equal(loadHudPreferences(session).gear, 2);
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [12, 34, 56]);
  assert.equal(loadHudPreferences(session).input.keys.slot9, "Digit0");
});

test("overlapping HUD and appearance saves merge with the last acknowledged settings", async () => {
  const session = store();
  let acknowledge!: () => void;
  const firstWrite = new Promise<void>(resolve => { acknowledge = resolve; });
  let writes = 0;
  const persist = session.savePreference;
  const asynchronous = {
    loadPreference: session.loadPreference,
    savePreference: async (key: string, value: string) => {
      if (++writes === 1) await firstWrite;
      persist(key, value);
    },
  };
  const appearance = saveInterfacePreferences(asynchronous, {theme: "light", defaultSpeed: 37, largeLabels: true});
  const hud = defaultsHudPreferences();
  hud.gearSpeeds = [17, 29, 83];
  const controls = saveHudPreferences(asynchronous, hud);
  acknowledge();
  await Promise.all([appearance, controls]);
  assert.deepEqual(loadHudPreferences(session).gearSpeeds, [17, 29, 83]);
  assert.deepEqual(loadInterface(session), {theme: "light", defaultSpeed: 37, largeLabels: true});
});

test("an earlier rejected settings save cannot turn a queued stale edit into a retry", async () => {
  const session = store();
  let reject!: (error: Error) => void;
  let writes = 0;
  const failure = new Promise<void>((_resolve, fail) => { reject = fail; });
  const asynchronous = {
    loadPreference: session.loadPreference,
    savePreference: async (key: string, value: string) => {
      if (++writes === 1) await failure;
      session.savePreference(key, value);
    },
  };
  const first = saveInterfacePreferences(asynchronous, {theme: "light", defaultSpeed: 37, largeLabels: true});
  const second = saveHudPreferences(asynchronous, defaultsHudPreferences());
  reject(Error("Shared settings changed; review before saving"));
  const outcomes = await Promise.allSettled([first, second]);
  assert.deepEqual(outcomes.map(result => result.status), ["rejected", "rejected"]);
  assert.equal(writes, 1);
  assert.equal(session.data.has("controllerSettings"), false);
  await saveHudPreferences(asynchronous, defaultsHudPreferences());
  assert.equal(writes, 2);
});
