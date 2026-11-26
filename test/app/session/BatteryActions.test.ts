import test from "node:test";
import assert from "node:assert/strict";
import { DroidSession } from "../../../app/session/DroidSession.ts";

/** A ready session snapshot with no transport; this fixture cannot open Bluetooth. */
class BatterySession extends DroidSession {
  bindFixture(id: string) {
    this.droidId = id;
    this.bindBatteryProfiling();
    this.publish({ state: "ready" });
  }
  startFixture() {
    this.sessionBattery.model.startFull();
    this.publish({});
  }
}
const actions = [
  "armBatteryProfiling",
  "startBatteryProfileFull",
  "stopBatteryProfiling",
  "finishBatteryProfileShutdown",
] as const;
for (const action of actions) {
  test(`${action} cannot report old-device success after binding changes during its commit`, async () => {
    let raw: string | null = null;
    let hold = false;
    let release!: () => void;
    const session = new BatterySession({
      factory: {
        async open() {
          throw Error("No transport in this fixture");
        },
      },
      preferences: { load: () => null, save() {} },
      batteryProfilingStorage: {
        load: () => raw,
        save: (value, expected) => {
          const commit = () => {
            assert.equal(raw, expected);
            raw = value;
          };
          if (!hold) return commit();
          hold = false;
          return new Promise<void>((resolve) => {
            release = () => {
              commit();
              resolve();
            };
          });
        },
      },
    });
    session.bindFixture("second");
    session.startFixture();
    const second = JSON.parse(raw!).devices["id:second"];
    session.bindFixture("first");
    if (action === "stopBatteryProfiling" || action === "finishBatteryProfileShutdown")
      session.startFixture();
    hold = true;
    const pending = session[action]();
    assert.equal(session.store.getSnapshot().batteryProfiling?.pending, true);
    session.bindFixture("second");
    release();
    await assert.rejects(pending, /droid.*changed|selection/i);
    assert.deepEqual(JSON.parse(raw!).devices["id:second"], second);
    assert.equal(session.store.getSnapshot().batteryProfiling?.deviceKey, "id:second");
  });
}
