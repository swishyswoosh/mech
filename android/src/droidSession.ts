import { cancelDeviceLightRecipe, releaseDeviceLightPriority } from "../../core/ramRecipe.ts";
import { DroidSession } from "../../app/session/DroidSession.ts";
import type { R2Controller } from "../../core/index.ts";
import { commands, encodePacket, UUIDS } from "../../core/index.ts";
import { AndroidTransportCore } from "../../core/transports/androidCore.ts";
import { toBase64 } from "../../core/transports/base64.ts";
import {
  isManualDemand,
  withManualIdleAcknowledgment,
} from "../../core/transports/manualDemand.ts";
import { ConnectionAttempts } from "./connectionAttempt.ts";
import { FixedPulseDrive } from "./fixedPulse.ts";
import { ResidentSourceLeases } from "./residentLeases.ts";
import { NativeSessionGate } from "./session.ts";

import type { NativeEvents, NativeSessionApi } from "./nativeSessionTypes.ts";
export type { NativeEvents, NativeSessionApi } from "./nativeSessionTypes.ts";
export const nativeStopFrames = (deviceRam = false) =>
  [
    ...(deviceRam ? [cancelDeviceLightRecipe(), releaseDeviceLightPriority()] : []),
    ...[
      commands.stopAnimation(),
      commands.idleAnimations(false),
      commands.trophy(false),
      commands.droidInteraction(false),
      commands.headTracking(false),
      commands.tank(0, 0),
      commands.rawMotors(0, 0, 0, 0),
      commands.stop(),
      commands.legAction(0),
      commands.stopAudio(),
      { did: 0x1f, cid: 0x15, data: new Uint8Array() },
    ],
  ].flatMap((command) => Array.from(encodePacket({ ...command, flags: 8, seq: 255 })));
export function createAndroidSession(options: {
  native: NativeSessionApi;
  events: NativeEvents;
  permissions: () => Promise<void>;
  choose: () => Promise<{ id: string; name?: string }>;
  cancelChoice: () => void;
}) {
  const { native, events } = options;
  const preferences = { ...native.preferences };
  const savePreference = async (key: string, value: string) => {
    await native.savePreference(key, value);
    preferences[key] = value;
  };
  const savedDroidsKey = "android.savedDroids.v1";
  const savedDroids = () => {
    try {
      const parsed: unknown = JSON.parse(preferences[savedDroidsKey] || "[]");
      if (!Array.isArray(parsed)) return [];
      const unique = new Map<string, { id: string; name: string }>();
      for (const item of parsed) {
        if (typeof item?.id !== "string" || !item.id.trim()) continue;
        unique.set(item.id, {
          id: item.id,
          name: typeof item.name === "string" && item.name.trim() ? item.name : item.id,
        });
      }
      return [...unique.values()];
    } catch {
      return [];
    }
  };
  let savedDroidWrites = Promise.resolve();
  const rememberDroid = (id: string, selectedName?: string) => {
    savedDroidWrites = savedDroidWrites
      .then(async () => {
        const saved = savedDroids();
        const name = selectedName || saved.find((droid) => droid.id === id)?.name || id;
        await savePreference(
          savedDroidsKey,
          JSON.stringify([...saved.filter((droid) => droid.id !== id), { id, name }]),
        );
      })
      .catch(() => {});
  };
  const safety = new NativeSessionGate(),
    attempts = new ConnectionAttempts();
  let controller: R2Controller,
    transport: AndroidTransportCore,
    pulses: FixedPulseDrive,
    resident: ResidentSourceLeases;
  let opening = false;
  let foreground = true;
  let permissionsPending = false;
  let resumePermission: (() => void) | undefined;
  let nativeConnected = false,
    selectedId: string | undefined,
    selectedName: string | undefined,
    onDisconnect = () => {},
    restarting = false;
  let restartWait: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const updateHeartbeat = () => {
    if (!foreground || !nativeConnected) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    } else if (heartbeat === undefined) {
      native.heartbeat();
      heartbeat = setInterval(() => native.heartbeat(), 100);
      (heartbeat as unknown as {unref?: () => void}).unref?.();
    }
  };
  const pauseForNativeStop = (reason: string) => {
    // Teardown owns its STOP and final disconnected publication. A native STOP
    // notification here must not increment sensorIntent and cancel that close.
    if (session.store.getSnapshot().state === "disconnecting") return;
    if (!nativeConnected && !opening && session.store.getSnapshot().state === "disconnected")
      return;
    if (
      controller?.state === "ready" &&
      ["ready", "paused"].includes(session.store.getSnapshot().state)
    ) {
      session.handleWindowBlur(false);
      if (foreground) void session.handleWindowFocus();
    } else {
      safety.reset();
      session.fail(reason);
    }
  };
  const sourceHooks = {
    async acquireSourceLease(id: string, drive = false) {
      safety.assertReady();
      await native.acquireSourceLease(id, drive);
      try {
        safety.assertReady();
        if (drive) transport.setDriveSource(id);
      } catch (error) {
        native.releaseSourceLease(id);
        throw error;
      }
    },
    renewSourceLease(id: string) {
      safety.assertReady();
      native.renewSourceLease(id);
    },
    releaseSourceLease(id: string) {
      transport.clearDriveSource(id);
      native.releaseSourceLease(id);
    },
  };
  const session = new DroidSession({
    initialDetail: "Select a droid to begin",
    batteryProfilingStorage: {
      load: () => {
        if (!native.loadBatteryProfiling)
          throw Error("This Android build needs the battery profiling storage bridge");
        return native.loadBatteryProfiling();
      },
      save: async (value, expected) => {
        if (!native.saveBatteryProfiling)
          throw Error("This Android build needs the battery profiling storage bridge");
        await native.saveBatteryProfiling(value, expected);
      },
    },
    preferences: {
      load: (key) => preferences[key] ?? null,
      save: savePreference,
    },
    factory: {
      authorizedDroids: async () => savedDroids(),
      cancel() {
        attempts.cancel();
        resumePermission?.();
        options.cancelChoice();
        void native.stopScan().catch(() => {});
      },
      async open(request) {
        if (opening) throw new Error("Connection already in progress");
        opening = true;
        let connecting = false;
        try {
          safety.reset();
          const attempt = attempts.begin();
          const check = () => {
            attempt.check();
            request.check();
          };
          // Android permission dialogs pause the host before any GATT link exists.
          // This requested attempt waits for the native host to return to the
          // foreground before scanning/connecting. Explicit cancellation wins.
          permissionsPending = true;
          try {
            await attempt.step(options.permissions);
            check();
            if (!foreground)
              await new Promise<void>((resolve) => {
                resumePermission = resolve;
              });
            check();
          } finally {
            permissionsPending = false;
            resumePermission = undefined;
          }
          request.selection(!request.authorizedId);
          let device: { id: string; name?: string };
          if (request.authorizedId)
            device = savedDroids().find((droid) => droid.id === request.authorizedId) ?? {
              id: request.authorizedId,
            };
          else {
            const chosen = options.choose();
            void chosen.catch(() => {});
            try {
              await attempt.step(() => native.scan());
              device = await attempt.step(() => chosen);
            } finally {
              options.cancelChoice();
              await native.stopScan();
            }
            check();
          }
          selectedId = device.id;
          selectedName = device.name;
          onDisconnect = request.onDisconnect;
          connecting = true;
          await attempt.step(() => native.connect(device.id));
          check();
          transport = new AndroidTransportCore(native, events);
          return { transport, id: device.id, name: device.name };
        } catch (error) {
          if (connecting) await native.disconnect().catch(() => {});
          throw error;
        } finally {
          opening = false;
        }
      },
      async restart(_connection, check) {
        restarting = true;
        try {
          if (nativeConnected)
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                restartWait = undefined;
                reject(new Error("Droid did not disconnect after application-start request."));
              }, 10000);
              restartWait = () => {
                clearTimeout(timer);
                restartWait = undefined;
                resolve();
              };
            });
          check();
          await native.connect(selectedId!);
          check();
        } finally {
          restarting = false;
        }
      },
    },
    hooks: {
      ...sourceHooks,
      attach(value) {
        controller = value;
        pulses = new FixedPulseDrive(native, () => session.nativePulseEnded());
        transport.setPulseHooks(pulses);
        resident = new ResidentSourceLeases(
          sourceHooks,
          () => controller.state === "ready" && nativeConnected,
          (error) => {
            pauseForNativeStop(String(error));
          },
        );
        transport.setSourceHooks(resident);
      },
      state(state) {
        if (state !== "ready") {
          safety.reset();
          resident?.stopAll();
        }
      },
      packet(packet) {
        resident?.observeResponse(packet);
      },
      async configureDeviceRamStop() {
        safety.assertReady();
        await native.armSafetyStop(
          transport.reference(UUIDS.api).service,
          toBase64(Uint8Array.from(nativeStopFrames(true))),
          500,
        );
        safety.assertReady();
      },
      async prepare(value, check) {
        const stopFrames = nativeStopFrames();
        const result = await safety.prepare(
          value,
          async () => {
            check();
            await native.armSafetyStop(
              transport.reference(UUIDS.api).service,
              toBase64(Uint8Array.from(stopFrames)),
              500,
            );
            check();
          },
          () => {
            check();
            return nativeConnected;
          },
        );
        check();
        // Confirm quiescent firmware before exposing READY, rather than making
        // the first joystick gesture wait behind the complete stop sequence.
        await value.replaceSources();
        check();
        // Fully initialized droids are remembered after the native safety stop
        // is armed, with storage latency kept off the READY and STOP paths.
        if (selectedId) rememberDroid(selectedId, selectedName);
        return {
          warnings: result.warnings,
          detail: `Ready. Raw identity/power replies (interpretation unverified): ${result.replies.map((reply) => reply.label + " = " + reply.hex).join("; ")}.${result.warnings.length ? " Compatibility warnings: " + result.warnings.join("; ") : ""}`,
        };
      },
      beforeResume: async (value) => {
        await value.replaceSources();
      },
      assertReady: () => safety.assertReady(),
      beforeArm() {
        safety.assertReady();
        if (pulses.active) throw new Error("Wait for the current pulse to end");
      },
      arm() {
        native.rearmManualInput();
      },
      async beforeExecute(command, access) {
        safety.assertReady();
        if (pulses.active && access.replace) await pulses.cancel();
        if (pulses.active && isManualDemand(command)) throw new Error("A fixed pulse owns driving");
        native.heartbeat();
      },
      execute: (command, send) =>
        withManualIdleAcknowledgment(command, send, () => native.manualIdleAcknowledged()),
      cancelSources() {
        transport?.clearDriveSource();
        resident?.stopAll();
      },
      async beforeReplace() {
        safety.assertReady();
        if (pulses.active) await pulses.cancel();
        safety.assertReady();
      },
      async releaseDrive(send) {
        safety.assertReady();
        if (pulses.active) {
          await pulses.cancel();
          return;
        }
        native.heartbeat();
        await send();
      },
      async pulse(command, advanced) {
        safety.assertReady();
        const send = () => {
          controller.nativeDrivePulseEnded("Fresh pulse replaces queued drive intent");
          controller.armMotion();
          return controller.command(command);
        };
        await (advanced ? pulses.runAdvanced(command, send) : pulses.run(command, send));
      },
      importLocalJson: () => native.importLocalJson(),
      importLocalJsonFiles: () => native.importLocalJsonFiles(),
      exportLocalJson: (name, text) => native.exportLocalJson(name, text),
      hashLocalText: (text) => native.hashLocalText(text),
    },
  });
  const stateListener = events.addListener(
    "R2BleState",
    ({ state, reason, appOwned }: { state: string; reason: string; appOwned?: boolean }) => {
      if (state === "connected") { nativeConnected = true; updateHeartbeat(); }
      if (state === "disconnected") {
        nativeConnected = false;
        updateHeartbeat();
        restartWait?.();
        onDisconnect();
      }
      if (state === "background") {
        foreground = false;
        updateHeartbeat();
        if (permissionsPending && !nativeConnected) return;
        attempts.cancel();
        options.cancelChoice();
        pauseForNativeStop(reason || "Native app backgrounded");
      }
      if (state === "foreground") {
        foreground = true;
        updateHeartbeat();
        resumePermission?.();
        void session.handleWindowFocus();
      }
      // App-owned STOP reports failure through its promise, even if this event arrives later.
      if (state === "safety-stop" && !appOwned) {
        pauseForNativeStop(reason || "Native safety stop");
      }
    },
  );
  const pulseListener = events.addListener("R2BlePulseEnded", ({ id }: { id: string }) =>
    pulses?.ended(id),
  );
  return {
    session,
    dispose() {
      foreground = false;
      updateHeartbeat();
      stateListener.remove();
      pulseListener.remove();
      void session.disconnect();
    },
  };
}
