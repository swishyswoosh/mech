import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRawCommand,
  rawConsoleCommand,
  sendRawConsoleCommand,
} from "../../../app/workshop/rawCommand.ts";
test("raw console parses hex bytes then applies the core allowlist", () => {
  const command = buildRawCommand("10", "00", "01 ff 2a");
  assert.deepEqual([...command.data], [1, 255, 42]);
  assert.throws(() => buildRawCommand("18", "06", ""), /restricted|vetted/);
  assert.throws(() => buildRawCommand("17", "05", "00 38"), /animation/);
  assert.throws(() => buildRawCommand("10", "00", "zz"), /hex/i);
  assert.throws(
    () => buildRawCommand("1f", "12", "00 00"),
    /service|restricted/i,
  );
});
test("raw console refuses drive actuators before a command can reach arming", () => {
  for (const [cid, payload] of [
    ["01", "01 ff 01 ff"],
    ["07", "20 00 00 00"],
    ["08", "20 20 00"],
  ] as const) {
    assert.throws(
      () => buildRawCommand("16", cid, payload),
      /bounded.*advanced drive/i,
    );
  }
});

test("the actual raw screen send handler blocks drive before manual arming or writes", async () => {
  let arms = 0,
    writes = 0;
  const execute = async () => {
    arms++;
    writes++;
    return "ack";
  };
  for (const [cid, payload] of [
    ["01", "01 ff 01 ff"],
    ["07", "20 00 00 00"],
    ["08", "20 20 00"],
  ] as const) {
    assert.throws(
      () => rawConsoleCommand("16", cid, payload),
      /bounded.*advanced drive/i,
    );
    await assert.rejects(
      sendRawConsoleCommand({ ready: true, execute }, "16", cid, payload),
      /bounded.*advanced drive/i,
    );
  }
  assert.equal(arms, 0);
  assert.equal(writes, 0);
  await assert.rejects(
    sendRawConsoleCommand({ ready: false, execute }, "10", "00", ""),
    /resume/i,
  );
  assert.equal(arms, 0);
  assert.equal(
    await sendRawConsoleCommand({ ready: true, execute }, "10", "00", "aa"),
    "ack",
  );
  assert.equal(writes, 1);
});
test("raw read, volume, audio-stop and masked LED requests retain their audited routes", async () => {
  const sent: { did: number; cid: number }[] = [];
  const execute = async (command: { did: number; cid: number }) => {
    sent.push(command);
  };
  for (const [did, cid, payload] of [
    ["11", "00", ""],
    ["1a", "08", "ff"],
    ["1a", "0a", ""],
    ["1a", "0e", "00 01 ff"],
  ] as const) {
    await sendRawConsoleCommand({ ready: true, execute }, did, cid, payload);
  }
  assert.deepEqual(
    sent.map((command) => [command.did, command.cid]),
    [
      [0x11, 0],
      [0x1a, 8],
      [0x1a, 10],
      [0x1a, 14],
    ],
  );
  await assert.rejects(
    sendRawConsoleCommand({ ready: true, execute }, "1f", "12", "00 00"),
    /restricted|service/,
  );
  assert.equal(sent.length, 4);
});
