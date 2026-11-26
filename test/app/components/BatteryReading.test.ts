import { test } from "node:test";
import assert from "node:assert/strict";
import { batteryReading } from "../../../app/components/BatteryReading.ts";

test("battery header converts the droid's big-endian centivolts to readable volts", () => {
  assert.equal(
    batteryReading("Battery voltage response: 01 88 (raw; no percentage)"),
    "3.92 V",
  );
  assert.equal(
    batteryReading("Battery voltage response: 01 8c (raw; no percentage)"),
    "3.96 V",
  );
  assert.equal(
    batteryReading("Battery voltage response: 01 a4 (raw; no percentage)"),
    "4.20 V",
  );
});
test("missing or malformed battery responses never imply a charge level", () => {
  for (const value of [
    undefined,
    "",
    "Battery voltage response empty; unavailable",
    "Battery voltage response: 01 (raw)",
    "Battery voltage response: 01 88 00 (raw)",
    "Battery voltage response: gg 88 (raw)",
  ]) {
    assert.equal(batteryReading(value), "Unavailable");
  }
});

test("battery indicator uses reported charge state without inventing percent or runtime", async () => {
  const { batteryLevel } = await import("../../../app/components/BatteryReading.ts");
  assert.equal(batteryLevel(Uint8Array.of(0)), "Full");
  assert.equal(batteryLevel(Uint8Array.of(1)), "Charging");
  assert.equal(batteryLevel(Uint8Array.of(2)), "Not charging");
  assert.equal(batteryLevel(Uint8Array.of(3)), "Good");
  assert.equal(batteryLevel(Uint8Array.of(4)), "Low");
  assert.equal(batteryLevel(Uint8Array.of(5)), "Critical");
  assert.equal(batteryLevel(Uint8Array.of(9)), "Unavailable");
  assert.equal(batteryLevel(Uint8Array.of(1, 2)), "Unavailable");
});

test("unavailable charge state falls back to a valid voltage in the header", async () => {
  const { batteryIndicator } = await import("../../../app/components/BatteryReading.ts");
  assert.deepEqual(
    batteryIndicator(
      "Unavailable",
      "Battery voltage response: 01 87 (raw; no percentage)",
    ),
    { label: "3.91 V", tone: "neutral" },
  );
  assert.deepEqual(
    batteryIndicator(
      "Good",
      "Battery voltage response: 01 87 (raw; no percentage)",
    ),
    { label: "Good", tone: "good" },
  );
  assert.deepEqual(
    batteryIndicator(
      "Low",
      "Battery voltage response: 01 87 (raw; no percentage)",
    ),
    { label: "Low", tone: "warning" },
  );
});
test("charging status is retained and missing voltage does not fabricate a level", async () => {
  const { batteryIndicator } = await import("../../../app/components/BatteryReading.ts");
  assert.deepEqual(batteryIndicator("Charging", undefined), {
    label: "Charging",
    tone: "neutral",
  });
  assert.deepEqual(batteryIndicator("Unavailable", undefined), {
    label: "No reading",
    tone: "neutral",
  });
});

test("accepted estimates expire and retain reported charging and low-battery warnings", async () => {
 const {profileBatteryIndicator: indicator}=await import('../../../app/components/BatteryReading.ts');
 const estimate={percent:50,at:1000};
 assert.equal(indicator('Good',undefined,estimate,2000,'ready').label,'~50%');
 for(const state of ['paused','disconnected','failed'])assert.equal(indicator('Good',undefined,estimate,2000,state).label,'Good');
 assert.equal(indicator('Good',undefined,estimate,121001,'ready').label,'Good');
 assert.equal(indicator('Charging',undefined,estimate,2000,'ready').label,'Charging');
 assert.equal(indicator('Low',undefined,estimate,2000,'ready').label,'Low');
 assert.equal(indicator('Critical',undefined,{percent:5,at:1000},2000,'ready').tone,'warning');
 assert.equal(indicator('Good',undefined,undefined,2000,'ready').label,'Good');
});
