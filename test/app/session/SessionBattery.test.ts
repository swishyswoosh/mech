import test from "node:test";
import assert from "node:assert/strict";
import { SessionBattery } from "../../../app/session/SessionBattery.ts";
import { DroidResponseError } from "../../../core/controller.ts";
import type { Packet } from "../../../core/protocol.ts";

const reply = (cid: number, error = 0): Packet => ({
  did: 19,
  cid,
  flags: 1,
  seq: 1,
  error,
  data: Uint8Array.of(3),
});
function memory() {
  let raw: string | null = null;
  return {
    load: () => raw,
    save: (text: string) => {
      raw = text;
    },
  };
}
for (const unsupported of [false, true]) {
  test(`an old ${unsupported ? "unsupported response" : "transport failure"} cannot contaminate the next droid battery poll`, async () => {
    let reject!: (error: Error) => void;
    const first = new Promise<Packet>((_, fail) => {
      reject = fail;
    });
    const requests: number[] = [];
    const battery = new SessionBattery({
      storage: memory(),
      allowed: () => true,
      changed() {},
      execute: (command) => {
        requests.push(command.cid);
        return requests.length === 1 ? first : Promise.resolve(reply(command.cid));
      },
    });
    battery.bind("first", undefined, "First");
    battery.model.arm();
    const oldPoll = battery.poll();
    battery.bind("second", undefined, "Second");
    battery.model.arm();
    reject(unsupported ? new DroidResponseError(reply(4, 2)) : new Error("Old link closed"));
    await oldPoll;
    assert.equal(battery.readError, undefined);
    await battery.poll();
    assert.deepEqual(requests, [4, 4], "the new droid must still receive its state query");
  });
}
test("a late successful voltage read cannot continue its old polling sequence on a new droid", async () => {
  let resolve!: (packet: Packet) => void;
  const first = new Promise<Packet>((done) => {
    resolve = done;
  });
  const requests: number[] = [];
  const battery = new SessionBattery({
    storage: memory(),
    allowed: () => true,
    changed() {},
    execute: (command) => {
      requests.push(command.cid);
      return requests.length === 1 ? first : Promise.resolve(reply(command.cid));
    },
  });
  battery.bind("first", undefined, "First");
  battery.model.startFull();
  const oldPoll = battery.poll();
  battery.bind("second", undefined, "Second");
  battery.model.startFull();
  resolve(reply(3));
  await oldPoll;
  assert.deepEqual(requests, [3], "old completion cannot dispatch the next query");
  await battery.poll();
  assert.deepEqual(requests, [3, 3, 4]);
});
test("a current unsupported response remains visible and suppresses repeated unsupported queries", async () => {
  const requests: number[] = [];
  const battery = new SessionBattery({
    storage: memory(),
    allowed: () => true,
    changed() {},
    execute: async (command) => {
      requests.push(command.cid);
      throw new DroidResponseError(reply(command.cid, 2));
    },
  });
  battery.bind("current", undefined, "Current");
  battery.model.arm();
  await battery.poll();
  assert.match(battery.readError ?? "", /state read unavailable/);
  battery.resetBudget();
  await battery.poll();
  assert.deepEqual(requests, [4]);
});
