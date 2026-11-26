import test from "node:test";
import assert from "node:assert/strict";
import { figureState, emptyFigure } from "../../../app/components/FigureState.ts";
import { commands } from "../../../core/commands.ts";
import type { TelemetryEvent } from "../../../core/telemetryEvents.ts";
const event = (
  command: ReturnType<typeof commands.leds>,
  phase: "requested" | "acknowledged" | "failed" = "acknowledged",
): TelemetryEvent => ({
  type: "command",
  id: 1,
  at: 0,
  phase,
  did: command.did,
  cid: command.cid,
  data: [...command.data],
});
test("hologram only reflects acknowledged commands and preserves unselected light channels", () => {
  const empty = emptyFigure();
  assert.equal(
    figureState(empty, event(commands.leds(7, [255, 0, 100]), "requested")),
    empty,
  );
  const first = figureState(empty, event(commands.leds(7, [255, 0, 100])));
  assert.deepEqual(first.lights.slice(0, 3), [255, 0, 100]);
  const second = figureState(first, event(commands.leds(2, [80])));
  assert.deepEqual(second.lights.slice(0, 3), [255, 80, 100]);
  assert.equal(
    figureState(second, event(commands.legAction(2), "failed")),
    second,
  );
  assert.equal(figureState(second, event(commands.legAction(2))).stance, "two");
  assert.equal(
    figureState(second, {
      type: "connection",
      state: "disconnected",
      detail: "lost",
      id: 2,
      at: 1,
    }).lights[0],
    undefined,
  );
});
