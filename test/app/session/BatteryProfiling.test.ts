import test from "node:test";
import assert from "node:assert/strict";
import {
  BatteryProfiling,
  batteryDeviceKey,
  BATTERY_PROFILING_KEY,
} from "../../../app/session/BatteryProfiling.ts";
import type { Packet } from "../../../core/protocol.ts";
const packet = (cid: number, data: number[], extra: Partial<Packet> = {}): Packet => ({
  did: 19,
  cid,
  seq: 1,
  flags: 1,
  error: 0,
  data: Uint8Array.from(data),
  ...extra,
});
const quiet = { quiet: true };
function storage() {
  let raw: string | null = null;
  return {
    load: () => raw,
    save: (text: string, expected: string | null) => {
      assert.equal(raw, expected);
      raw = text;
    },
  };
}
function voltage(model: BatteryProfiling, volts: number, at: number, resting = true) {
  const raw = Math.round(volts * 100);
  model.response(packet(3, [raw >> 8, raw & 255]), { quiet: resting }, at);
}
function cycle(model: BatteryProfiling, index: number) {
  const start = 100000 + index * 2000000;
  model.startFull(start);
  for (let i = 0; i <= 30; i++) voltage(model, 3.3 + 0.9 * (1 - i / 30) ** 2, start + i * 60000);
  model.finishShutdown(start + 30 * 60000);
}
test("collection is opt-in, waits for Full, and ignores malformed or failed observations", () => {
  const model = new BatteryProfiling(storage());
  model.bind("id:r2", "R2");
  voltage(model, 4.1, 1000);
  assert.equal(model.summary.sampleCount, 0);
  model.arm();
  assert.equal(model.summary.mode, "waiting-full");
  for (const p of [
    packet(4, [1]),
    packet(4, [3]),
    packet(4, [0], { error: 3 }),
    packet(4, [0], { flags: 0 }),
    packet(4, [0, 0]),
  ])
    model.response(p, quiet, 2000);
  voltage(model, 4.2, 3000);
  assert.equal(model.summary.sampleCount, 0);
  model.response(packet(4, [0]), quiet, 4000);
  voltage(model, 4.2, 4000);
  assert.equal(model.summary.mode, "recording");
  assert.equal(model.summary.sampleCount, 1);
  model.stop(5000);
  voltage(model, 4, 6000);
  assert.equal(model.summary.sampleCount, 1);
  assert.equal(model.summary.validation.profile, undefined);
});
test("three cycles produce a candidate but never change the display without Use this profile", async () => {
  const store = storage(),
    model = new BatteryProfiling(store);
  model.bind("id:r2", "R2");
  for (let i = 1; i <= 3; i++) cycle(model, i);
  const candidate = model.summary.validation.profile!;
  assert.ok(candidate);
  voltage(model, 3.53, 8000000);
  assert.equal(model.estimate(8000000), undefined);
  await model.useProfile(candidate.id);
  assert.equal(model.estimate(8000000)?.percent, 50);
  assert.equal(model.summary.activeProfile?.id, candidate.id);
  cycle(model, 4);
  assert.notEqual(model.summary.validation.profile?.id, candidate.id);
  assert.equal(model.summary.activeProfile?.id, candidate.id);
  const reopened = new BatteryProfiling(store);
  reopened.bind("id:r2", "R2");
  voltage(reopened, 3.53, 11000000);
  assert.equal(reopened.estimate(11000000)?.percent, 50);
  assert.equal(reopened.estimate(11120001), undefined);
  await reopened.useReportedState();
  assert.equal(reopened.estimate(11000000), undefined);
  assert.equal(new BatteryProfiling(store).summary.activeProfile, undefined);
});
test("a different droid cannot inherit collection or a percentage and stale candidates cannot be applied", async () => {
  const model = new BatteryProfiling(storage());
  model.bind("id:r2", "R2");
  for (let i = 1; i <= 3; i++) cycle(model, i);
  const candidate = model.summary.validation.profile!;
  cycle(model, 4);
  await assert.rejects(model.useProfile(candidate.id), /changed|stale/i);
  model.bind("id:other", "Other");
  voltage(model, 3.53, 12000000);
  assert.equal(model.summary.sampleCount, 0);
  assert.equal(model.estimate(12000000), undefined);
  await assert.rejects(model.useProfile(candidate.id));
  assert.equal(batteryDeviceKey("desktop:last"), undefined);
  assert.equal(batteryDeviceKey(undefined), undefined);
  assert.equal(batteryDeviceKey("desktop:last", "radio-uuid"), "hardware:radio-uuid");
});
test("charging interrupts a discharge; neither disconnect nor Stop supplies a low endpoint", () => {
  const model = new BatteryProfiling(storage());
  model.bind("id:r2", "R2");
  model.startFull(1000);
  voltage(model, 4.2, 1000);
  model.connection("disconnected", 2000);
  assert.equal(model.summary.mode, "recording");
  assert.equal(model.summary.current?.endedAt, undefined);
  model.response(packet(4, [1]), quiet, 3000);
  assert.equal(model.summary.mode, "idle");
  assert.match(model.summary.runs[0].problem ?? "", /charg/i);
  model.startFull(4000);
  voltage(model, 4.2, 4000);
  model.stop(5000);
  assert.equal(model.summary.runs.at(-1)?.endpoint, undefined);
});
test("Critical finishes only with a fresh quiet reading; loaded or charging readings never estimate", async () => {
  const model = new BatteryProfiling(storage());
  model.bind("id:r2", "R2");
  for (let i = 1; i <= 3; i++) cycle(model, i);
  await model.useProfile(model.summary.validation.profile!.id);
  voltage(model, 3.53, 8000000, false);
  assert.equal(model.estimate(8000000), undefined);
  voltage(model, 3.53, 8060000);
  model.response(packet(4, [1]), quiet, 8060000);
  assert.equal(model.estimate(8060000), undefined);
  model.startFull(9000000);
  voltage(model, 4.2, 9000000);
  model.response(packet(4, [5]), quiet, 9200000);
  assert.equal(model.summary.mode, "recording");
  voltage(model, 3.3, 9200000);
  assert.equal(model.summary.mode, "idle");
  assert.equal(model.summary.runs.at(-1)?.endpoint, "critical");
});
test("queued profile activation changes the display only after disk acknowledgment", async () => {
  const base = storage(),
    initial = new BatteryProfiling(base);
  initial.bind("id:r2", "R2");
  for (let i = 1; i <= 3; i++) cycle(initial, i);
  let resolve!: () => void;
  const model = new BatteryProfiling({
    load: base.load,
    save: (value, expected) =>
      new Promise<void>((yes) => {
        resolve = () => {
          base.save(value, expected);
          yes();
        };
      }),
  });
  model.bind("id:r2", "R2");
  voltage(model, 3.53, 8000000);
  const applying = model.useProfile(model.summary.validation.profile!.id);
  await Promise.resolve();
  assert.equal(model.estimate(8000000), undefined);
  assert.equal(model.summary.pending, true);
  resolve();
  await applying;
  assert.equal(model.estimate(8000000)?.percent, 50);
});
test("failed/corrupt storage preserves acknowledged data, reports in Depot and cannot apply a profile", async () => {
  const base = storage(),
    initial = new BatteryProfiling(base);
  initial.bind("id:r2", "R2");
  for (let i = 1; i <= 3; i++) cycle(initial, i);
  const original = base.load();
  const model = new BatteryProfiling({
    load: base.load,
    save: async () => {
      throw Error("disk full");
    },
  });
  model.bind("id:r2", "R2");
  await assert.rejects(model.useProfile(model.summary.validation.profile!.id), /disk full/);
  assert.equal(model.summary.activeProfile, undefined);
  assert.equal(base.load(), original);
  assert.ok(model.summary.storageError);
  const damaged = new BatteryProfiling({
    load: () => "{bad",
    save: () => {
      throw Error("must not overwrite");
    },
  });
  damaged.bind("id:r2", "R2");
  assert.throws(() => damaged.startFull(), /storage|history|JSON/i);
  assert.equal(JSON.parse(damaged.export().text).original, "{bad");
});
test("export is frozen while new observations arrive and old raw-history keys are never overwritten", () => {
  const base = storage(),
    model = new BatteryProfiling(base);
  model.bind("id:r2", "R2");
  model.startFull(1000);
  voltage(model, 4.2, 1000);
  const first = model.export();
  voltage(model, 4.1, 61000);
  assert.equal(JSON.parse(first.text).devices["id:r2"].runs[0].samples.length, 1);
  assert.equal(JSON.parse(model.export().text).devices["id:r2"].runs[0].samples.length, 2);
  assert.notEqual(BATTERY_PROFILING_KEY, "battery.history.v1");
});
test("return to Full after observed discharge rejects a missed recharge, but repeated initial Full is harmless", () => {
  const memory = {
    raw: null as string | null,
    load() {
      return this.raw;
    },
    save(value: string) {
      this.raw = value;
    },
  };
  const m = new BatteryProfiling(memory);
  m.bind("id:r2");
  m.startFull(100000);
  const reply = (state: number, at: number) =>
    m.response(
      { did: 19, cid: 4, seq: 1, flags: 1, error: 0, data: Uint8Array.of(state) },
      { quiet: true },
      at,
    );
  reply(0, 100001);
  reply(0, 100002);
  assert.equal(m.summary.mode, "recording");
  reply(3, 160000);
  m.connection("disconnected");
  reply(0, 220000);
  assert.equal(m.summary.mode, "idle");
  assert.match(m.summary.runs[0].problem!, /Full|recharg/i);
  assert.equal(m.summary.validation.profile, undefined);
});

test("a queued reported-state choice cannot clear another droid profile after selection changes", async () => {
  const base = storage(),
    initial = new BatteryProfiling(base);
  for (const key of ["id:first", "id:second"]) {
    initial.bind(key, key);
    for (let i = 1; i <= 3; i++) cycle(initial, i);
    await initial.useProfile(initial.summary.validation.profile!.id);
  }
  const previous = JSON.parse(base.load()!).devices;
  let release!: () => void,
    held = true;
  const model = new BatteryProfiling({
    load: base.load,
    save: (value, expected) => {
      if (!held) return base.save(value, expected);
      held = false;
      return new Promise<void>((resolve) => {
        release = () => {
          base.save(value, expected);
          resolve();
        };
      });
    },
  });
  model.bind("id:first", "First");
  model.arm();
  const choosing = model.useReportedState();
  model.bind("id:second", "Second");
  release();
  await assert.rejects(choosing, /droid.*changed|selection/i);
  const after = JSON.parse(base.load()!).devices;
  assert.deepEqual(after["id:first"].activeProfile, previous["id:first"].activeProfile);
  assert.deepEqual(after["id:second"].activeProfile, previous["id:second"].activeProfile);
  assert.equal(model.summary.activeProfile?.id, previous["id:second"].activeProfile.id);
});
test("an acknowledged profile choice for an earlier binding cannot announce success for the newly selected droid", async () => {
  const base = storage(),
    initial = new BatteryProfiling(base);
  for (const key of ["id:first", "id:second"]) {
    initial.bind(key, key);
    for (let i = 1; i <= 3; i++) cycle(initial, i);
    await initial.useProfile(initial.summary.validation.profile!.id);
  }
  let release!: () => void;
  const model = new BatteryProfiling({
    load: base.load,
    save: (value, expected) =>
      new Promise<void>((resolve) => {
        release = () => {
          base.save(value, expected);
          resolve();
        };
      }),
  });
  model.bind("id:first", "First");
  const choosing = model.useReportedState();
  await Promise.resolve();
  assert.equal(model.summary.pending, true);
  model.bind("id:second", "Second");
  release();
  await assert.rejects(choosing, /droid.*changed|selection/i);
  assert.ok(model.summary.activeProfile);
  assert.equal(
    JSON.parse(base.load()!).devices["id:first"].activeProfile,
    undefined,
    "the already submitted first-droid change still commits normally",
  );
});
test("observers see a pending profile commit before the acknowledgment arrives", async () => {
  const base = storage(),
    initial = new BatteryProfiling(base);
  initial.bind("id:r2");
  for (let i = 1; i <= 3; i++) cycle(initial, i);
  let release!: () => void;
  const pending: boolean[] = [];
  const model = new BatteryProfiling(
    {
      load: base.load,
      save: (value, expected) =>
        new Promise<void>((resolve) => {
          release = () => {
            base.save(value, expected);
            resolve();
          };
        }),
    },
    () => pending.push(model.summary.pending),
  );
  model.bind("id:r2");
  const applying = model.useProfile(model.summary.validation.profile!.id);
  await Promise.resolve();
  assert.deepEqual(pending, [true], "the pending state must be published before storage settles");
  assert.equal(model.summary.activeProfile, undefined);
  release();
  await applying;
  assert.equal(pending.at(-1), false);
});
