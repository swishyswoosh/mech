import test from "node:test";
import assert from "node:assert/strict";
import {
  volumeDraftCommand,
  soundSectorDraftCommand,
} from "../../../app/workshop/audioCommands.ts";
test("volume draft retains the complete byte range and rejects invalid native entry", () => {
  assert.deepEqual([...volumeDraftCommand("0").data], [0]);
  assert.deepEqual([...volumeDraftCommand("255").data], [255]);
  for (const value of ["", " ", "-1", "256", "3.5", "bad"])
    assert.throws(() => volumeDraftCommand(value), /0.*255/);
});
test("raw sound sector retains the full unsigned16bit range in vetted playback mode0", () => {
  assert.deepEqual([...soundSectorDraftCommand("0").data], [0, 0, 0]);
  assert.deepEqual([...soundSectorDraftCommand("65535").data], [255, 255, 0]);
  for (const value of ["", "-1", "65536", "1.2", "bad"])
    assert.throws(() => soundSectorDraftCommand(value), /0.*65535/);
});
