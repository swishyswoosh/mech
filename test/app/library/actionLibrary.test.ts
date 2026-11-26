import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionDescription,
  loadFavorites,
  toggleFavorite,
  soundCategory,
  ActionPlayback,
} from "../../../app/library/actionLibrary.ts";
test("decoded schedule descriptions retain verified resource requests, durations and unnamed audio slot", () => {
  const drive = actionDescription(11);
  assert.match(drive, /dome/i);
  assert.match(drive, /drive speed/i);
  assert.match(drive, /11.041/);
  assert.match(drive, /3607.*uncatalogued/);
  assert.match(drive, /completion unknown/i);
  assert.match(actionDescription(55), /2970/);
  assert.match(actionDescription(55), /duration unknown/i);
});
test("favorites validate persistent keys and category labels follow catalog names", () => {
  assert.deepEqual(loadFavorites('["animation:7","sound:23","animation:999","bogus","sound:23"]'), [
    "animation:7",
    "sound:23",
  ]);
  assert.deepEqual(toggleFavorite(["animation:7"], "animation:7"), []);
  assert.deepEqual(toggleFavorite([], "sound:23"), ["sound:23"]);
  assert.deepEqual(loadFavorites("bad"), []);
  assert.equal(soundCategory("R2_Chatty_17"), "Chatty");
  assert.equal(soundCategory("R2 Fall"), "Effects");
});
test("playback uses matching ACK and elapsed only, never inferred schedule completion", () => {
  const playback = new ActionPlayback();
  const command = { type: "command" as const, did: 0x17, cid: 5, data: [0, 7] };
  playback.accept({ ...command, id: 1, at: 100, phase: "requested" });
  assert.equal(playback.state?.status, "requested");
  playback.accept({ ...command, id: 2, at: 120, phase: "acknowledged" });
  assert.equal(playback.state?.ackAt, 120);
  assert.equal(playback.elapsed(10000), 9880);
  assert.equal(playback.state?.status, "acknowledged");
  playback.accept({
    type: "command",
    id: 3,
    at: 10001,
    did: 0x17,
    cid: 43,
    data: [],
    phase: "acknowledged",
  });
  assert.equal(playback.state?.status, "stop-acknowledged");
});
test("queued duplicate playback ACKs cannot acknowledge the newer request, and STOP fences late replies", () => {
  const playback = new ActionPlayback(),
    command = { type: "command" as const, did: 0x17, cid: 5, data: [0, 7] };
  playback.accept({ ...command, id: 1, at: 100, phase: "requested" });
  playback.accept({ ...command, id: 2, at: 110, phase: "requested" });
  playback.accept({ ...command, id: 3, at: 120, phase: "acknowledged" });
  assert.equal(playback.state?.status, "requested");
  playback.accept({ ...command, id: 4, at: 130, phase: "acknowledged" });
  assert.equal(playback.state?.ackAt, 130);
  playback.accept({ ...command, id: 5, at: 140, phase: "requested" });
  playback.interrupt();
  playback.accept({ ...command, id: 6, at: 150, phase: "acknowledged" });
  assert.equal(playback.state?.status, "interrupted");
});
test("fresh library always supplies both scoped stops independently of playback or group", async () => {
  const { actionLibraryStops } = await import("../../../app/library/actionLibrary.ts");
  assert.deepEqual(
    actionLibraryStops.map((item) => [
      item.title,
      item.build().did,
      item.build().cid,
      Array.from(item.build().data),
    ]),
    [
      ["Stop animation", 0x17, 43, []],
      ["Stop all audio", 0x1a, 10, []],
    ],
  );
});
test("a scoped STOP acknowledgement fences the pending playback reply", () => {
  const playback = new ActionPlayback(),
    command = { type: "command" as const, did: 0x17, cid: 5, data: [0, 7] };
  playback.accept({ ...command, id: 1, at: 100, phase: "requested" });
  playback.accept({
    type: "command",
    id: 2,
    at: 110,
    did: 0x17,
    cid: 43,
    data: [],
    phase: "acknowledged",
  });
  playback.accept({ ...command, id: 3, at: 120, phase: "acknowledged" });
  assert.equal(playback.state?.status, "stop-acknowledged");
});
