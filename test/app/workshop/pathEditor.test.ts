import test from "node:test";
import assert from "node:assert/strict";
import {
  editWaypoint,
  moveWaypoint,
  previewPosition,
  readPathDraft,
  PathTraversal,
} from "../../../app/workshop/pathEditor.ts";
const points = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 40 },
];
test("waypoint editing is granular, immutable, and validates coordinates", () => {
  assert.deepEqual(editWaypoint(points, 1, "replace", { x: 15, y: 9 }), [
    points[0],
    { x: 15, y: 9 },
    points[2],
  ]);
  assert.equal(points[1].x, 30);
  assert.deepEqual(editWaypoint(points, 1, "insert", { x: 5, y: 6 }), [
    points[0],
    points[1],
    { x: 5, y: 6 },
    points[2],
  ]);
  assert.deepEqual(editWaypoint(points, 1, "delete"), [points[0], points[2]]);
  assert.throws(
    () => editWaypoint(points, 1, "replace", { x: NaN, y: 0 }),
    /coordinate/i,
  );
  assert.throws(
    () =>
      editWaypoint(
        Array.from({ length: 256 }, () => ({ x: 0, y: 0 })),
        0,
        "insert",
        { x: 0, y: 0 },
      ),
    /256/,
  );
});
test("waypoints reorder without altering neighboring coordinates", () => {
  assert.deepEqual(moveWaypoint(points, 1, -1), [
    points[1],
    points[0],
    points[2],
  ]);
  assert.throws(() => moveWaypoint(points, 0, -1), /boundary/i);
});
test("old points-only drafts and full drafts retain settings", () => {
  assert.deepEqual(readPathDraft(JSON.stringify(points)).points, points);
  assert.equal(
    readPathDraft(
      JSON.stringify({
        version: 1,
        units: "preview",
        points,
        speedPercent: 13,
        startOrientation: 245,
      }),
    ).startOrientation,
    245,
  );
  assert.throws(() => readPathDraft("{bad"));
});
test("preview follows cumulative distance with heading and bounded progress", () => {
  assert.deepEqual(previewPosition(points, 0.5, 90), {
    x: 30,
    y: 5,
    heading: 270,
    segment: 1,
  });
  assert.equal(previewPosition(points, 5, 0)?.y, 40);
  assert.equal(previewPosition([], 0, 0), undefined);
});
test("local traversal starts, pauses without replay, resumes, completes, and stops", () => {
  const preview = new PathTraversal();
  assert.throws(() => preview.start([], 25, 0, 0), /two distinct/i);
  assert.throws(() => preview.start(points, 0, 0, 0), /positive/i);
  preview.start(points, 25, 0, 1000);
  assert.equal(preview.tick(2000).progress, 25 / 70);
  preview.pause(2000);
  assert.equal(preview.tick(5000).progress, 25 / 70);
  preview.resume(5000);
  assert.equal(preview.tick(6000).progress, 50 / 70);
  assert.equal(preview.tick(10000).status, "completed");
  preview.stop();
  assert.deepEqual(preview.snapshot, { status: "idle", progress: 0 });
});
test("fine drawing resolution retains nearby detail and respects point capacity", async () => {
  const { sampleWaypoint } = await import("../../../app/workshop/pathEditor.ts");
  assert.deepEqual(sampleWaypoint([{ x: 0, y: 0 }], { x: 2, y: 0 }, 2), [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ]);
  assert.equal(sampleWaypoint([{ x: 0, y: 0 }], { x: 2, y: 0 }, 4).length, 1);
  assert.equal(
    sampleWaypoint(
      Array.from({ length: 256 }, () => ({ x: 0, y: 0 })),
      { x: 20, y: 0 },
      2,
    ).length,
    256,
  );
  assert.throws(() => sampleWaypoint([], { x: 0, y: 0 }, 0), /spacing/);
});
test("ordinary orientation editing keeps invalid intermediate values from crashing preview", () => {
  for (const orientation of [360, -1, 3500, NaN]) {
    assert.doesNotThrow(() => previewPosition(points, 0.5, orientation));
    assert.equal(previewPosition(points, 0.5, orientation), undefined);
  }
});

test('drawing maps to the same route coordinates when the canvas is resized',async()=>{
 const {canvasPoint}=await import('../../../app/workshop/pathEditor.ts');
 const bounds={minX:0,minY:0,maxX:600,maxY:280};
 assert.deepEqual(canvasPoint(300,140,600,280,bounds),{x:300,y:140});
 assert.deepEqual(canvasPoint(150,50,300,100,bounds),{x:300,y:140});
 assert.deepEqual(canvasPoint(300,100,300,100,bounds),{x:600,y:280});
 assert.deepEqual(canvasPoint(-20,140,300,100,bounds),{x:0,y:280});
});
