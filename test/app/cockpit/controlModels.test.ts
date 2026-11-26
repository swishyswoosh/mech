import { test } from "node:test";
import assert from "node:assert/strict";
import { FloatingJoystick, shapeAxis, angleAt } from "../../../app/cockpit/controlModels.ts";
import { WheelCheck } from "../../../app/cockpit/WheelCheck.ts";
test("floating joystick owns first contact, clamps and uses an 8 percent dead zone with fine expo", () => {
  const pad = new FloatingJoystick();
  assert.deepEqual(pad.begin(1, 40, 50), [0, 0]);
  assert.equal(pad.begin(2, 100, 100), undefined);
  assert.deepEqual(pad.move(2, 100, 0, 100), undefined);
  assert.deepEqual(pad.move(1, 45, 50, 100), [0, 0]);
  const half = pad.move(1, 90, 50, 100)!;
  assert.ok(half[0] > 0 && half[0] < 0.5);
  assert.equal(half[1], 0);
  assert.ok(
    pad
      .move(1, 540, -450, 100)!
      .every((v) => Math.abs(v - Math.SQRT1_2) < 1e-12),
  );
  assert.equal(pad.end(2), false);
  assert.equal(pad.end(1), true);
  assert.equal(pad.move(1, 0, 0, 100), undefined);
  assert.equal(shapeAxis(NaN), 0);
  assert.equal(angleAt(0, -1), 0);
  assert.equal(angleAt(-1, 0), -90);
  assert.equal(angleAt(0, 1), 180);
});
test("wheel check needs a completed bounded nudge for each confirmation; swap invalidates that observation", async () => {
  let validated = 0;
  let complete!: () => void;
  const demands: string[] = [];
  const check = new WheelCheck(
    3,
    () => validated++,
    (direction) => {
      demands.push(direction);
      return new Promise<void>((r) => (complete = r));
    },
  );
  assert.throws(() => check.confirm(), /nudge/i);
  check.prepare();
  const forward = check.nudge();
  assert.throws(() => check.confirm(), /nudge/i);
  complete();
  await forward;
  check.swap();
  assert.equal(check.ySign, -1);
  assert.throws(() => check.confirm(), /nudge/i);
  const retry = check.nudge();
  complete();
  await retry;
  check.confirm();
  assert.equal(check.stage, "turn");
  const turn = check.nudge();
  complete();
  await turn;
  check.confirm();
  assert.equal(check.stage, "complete");
  assert.equal(validated, 1);
  assert.deepEqual(demands, ["Forward", "Reverse", "Turn Left"]);
});
test("wheel check boundary and failed pulse cannot validate old observations", async () => {
  let validated = 0;
  const check = new WheelCheck(
    3,
    () => validated++,
    async () => {
      throw Error("zero failed");
    },
  );
  check.prepare();
  await assert.rejects(check.nudge(), /zero failed/);
  assert.throws(() => check.confirm(), /nudge/i);
  check.cancel();
  assert.throws(() => check.prepare(), /expired/i);
  assert.equal(validated, 0);
});

test("shaped input adapts to existing arcade dead zone exactly once", async () => {
  const { toArcadeInput, shapePoint } = await import("../../../app/cockpit/controlModels.ts");
  const { arcade } = await import("../../../core/drive.ts");
  for (const r of [0.08, 0.09, 0.2, 0.5, 1]) {
    const p = shapePoint(0, r);
    const wheels = arcade(...toArcadeInput(p), 1);
    assert.ok(Math.abs(wheels[0] - p[1]) < 1e-12);
    assert.ok(Math.abs(wheels[1] - p[1]) < 1e-12);
  }
});

test("dome pointer is revoked by STOP and needs fresh grant before another target", async () => {
  const { DomeGesture } = await import("../../../app/cockpit/controlModels.ts");
  const g = new DomeGesture();
  assert.equal(g.begin(1), true);
  assert.equal(g.begin(2), false);
  assert.equal(g.move(1, 1, 0), 90);
  g.cancel();
  assert.equal(g.move(1, 0, -1), undefined);
  assert.equal(g.begin(2), true);
  assert.equal(g.move(2, 0, -1), 0);
});
