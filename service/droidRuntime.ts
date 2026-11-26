import { DroidSession } from "../app/session/DroidSession.ts";
import type { PreferenceStore, SessionSnapshot, TransportFactory } from "../app/session/types.ts";
import type { R2Controller } from "../core/controller.ts";
import {
  catalog,
  deviceLightProtocol,
  DEVICE_LIGHT_PROTOCOL_ID,
  lightCommand,
  LIGHT_SETTING_CHANNELS,
  MOTION_UNAVAILABLE,
} from "./catalogs.ts";
import type { CatalogItem } from "./catalogs.ts";
import { parseDeviceLightFile } from "../core/deviceLightFiles.ts";

export interface RuntimeResult {
  confirmation: "ack" | "notification" | "none";
  state: "dispatched" | "completed";
  evidence?: unknown;
}
export interface PreparedRuntimeAction {
  parameters: Record<string, unknown>;
  execute(): Promise<RuntimeResult>;
}
export interface DroidRuntime {
  snapshot(): SessionSnapshot;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
  catalogs(kind: string): { items: CatalogItem[] };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  stop(): Promise<void>;
  prepare(action: string, parameters: Record<string, unknown>): PreparedRuntimeAction;
  execute(action: string, parameters: Record<string, unknown>): Promise<RuntimeResult>;
  busy(): boolean;
  dispose(): Promise<void>;
}
const owners = new Map<string, symbol>();
const services = ["00010001-574f-4f20-5370-6865726f2121", "00020001-574f-4f20-5370-6865726f2121"];

/** One service-owned shared session. Construction, snapshots and catalogs never
 * discover or wake hardware. The supplied store is service-global persistence. */
export function createDroidRuntime(config: {
  id: string;
  name: string;
  factory: TransportFactory;
  preferences: PreferenceStore;
}): DroidRuntime {
  const token = Symbol(config.id),
    faultKey = `service.runtime.fault.${config.id}`;
  let controller: R2Controller | undefined,
    disposed = false,
    pending = 0,
    stopWork: Promise<void> | undefined,
    sleepConfirmed = false,
    connecting = false,
    releaseAfterConnection = false;
  let transportClose: Promise<void> | undefined;
  let connectionWork: Promise<void> | undefined;
  let disposalWork: Promise<void> | undefined;
  let fault = config.preferences.load(faultKey);
  // The shared controller starts transport closure from its did-sleep handler.
  // Retaining that exact promise prevents the service operation from finishing early.
  const factory: TransportFactory = {
    open: async (request) => {
      const connection = await config.factory.open(request);
      transportClose = undefined;
      const transport = new Proxy(connection.transport, {
        get(target, key) {
          if (key === "disconnect")
            return () => (transportClose ??= Promise.resolve().then(() => target.disconnect()));
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return { ...connection, transport };
    },
    validateServices: config.factory.validateServices?.bind(config.factory),
    authorizedDroids: config.factory.authorizedDroids?.bind(config.factory),
    cancel: config.factory.cancel?.bind(config.factory),
    restart: config.factory.restart?.bind(config.factory),
  };
  const session = new DroidSession({
    factory,
    preferences: config.preferences,
    attitudeTelemetry: false,
    initialDetail: "Disconnected. Connect explicitly to wake this droid.",
    hooks: {
      attach: (value) => {
        controller = value;
      },
      beforeArm: () => {
        throw Error(MOTION_UNAVAILABLE);
      },
      ownership: {
        acquire: async () => {
          if (owners.has(config.id) && owners.get(config.id) !== token)
            throw Error("Droid already has a runtime owner");
          owners.set(config.id, token);
        },
        release: () => {
          if (owners.get(config.id) !== token) return;
          // Canceling selection can precede the factory's actual transport cleanup.
          if (connecting) {
            releaseAfterConnection = true;
            return;
          }
          if (!disposed && owners.get(config.id) === token) owners.delete(config.id);
        },
      },
    },
  });
  const detachPower = session.subscribeEvents((event) => {
    if (event.type === "notification" && event.notification.type === "did-sleep")
      sleepConfirmed = true;
  });
  const detachFault = session.store.subscribe(() => {
    const state = session.store.getSnapshot();
    if (state.state === "failed") {
      fault = state.detail || "Droid session failed";
      // The in-memory fault remains latched even if its audit write fails.
      // Neither synchronous nor asynchronous storage failure can delay STOP.
      try {
        void Promise.resolve(config.preferences.save(faultKey, fault)).catch(() => {});
      } catch {}
    }
  });
  const snapshot = (): SessionSnapshot => {
    const value = session.store.getSnapshot();
    return {
      ...value,
      ...(sleepConfirmed && value.state === "disconnected" ? { state: "sleeping" } : {}),
      ...(fault ? { state: "failed", detail: fault } : {}),
      connection: { ...value.connection, droidId: config.id, droidName: config.name },
      safety: fault ? { ...value.safety, state: "failed", canControl: false } : value.safety,
    };
  };
  const usable = () => {
    if (disposed) throw Error("Runtime disposed");
    if (fault) throw Error(`Droid session failed: ${fault}`);
  };
  const ready = () => {
    usable();
    if (session.store.getSnapshot().state !== "ready") throw Error("Droid is not ready");
  };
  const tracked = async <T>(run: () => Promise<T>): Promise<T> => {
    pending++;
    try {
      return await run();
    } finally {
      pending--;
    }
  };
  const stop = (): Promise<void> => {
    if (stopWork) return stopWork;
    if (disposed) return Promise.reject(Error("Runtime disposed"));
    const work = tracked(async () => {
      const state = session.store.getSnapshot().state;
      if (connecting && !["ready", "failed", "paused"].includes(state)) {
        // Selection/initialization is revocable work, not a retained ready
        // session. Existing intent fencing closes a factory result arriving
        // after this cancellation before it can initialize or become ready.
        await session.disconnect();
        return;
      }
      // Priority writes revoke intent first. Matching STOP replies then prove
      // resource release; the response-free emergency batch cannot prove it.
      await session.stop(true);
      if (session.store.getSnapshot().state === "failed")
        throw Error(fault ?? "Failed session remains blocked");
      try {
        await session.replaceSources();
      } catch (error) {
        if (session.store.getSnapshot().state !== "ready")
          session.fail(`STOP confirmation failed: ${String(error)}`);
        throw error;
      }
    });
    stopWork = work;
    void work.then(
      () => {
        stopWork = undefined;
      },
      () => {
        stopWork = undefined;
      },
    );
    return work;
  };
  const prepare = (action: string, parameters: Record<string, unknown>): PreparedRuntimeAction => {
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters))
      throw Error("Action parameters must be an object");
    if (action === "sound.play") {
      if (
        Object.keys(parameters).some((key) => key !== "sound_id") ||
        typeof parameters.sound_id !== "string"
      )
        throw Error("A catalog sound_id is required");
      const sound = catalog("sounds", config.preferences).items.find(
        (item) => item.id === parameters.sound_id,
      );
      if (!sound) throw Error("Unknown sound");
      return {
        parameters: { sound_id: sound.id },
        execute: async () => {
          ready();
          const packet = await tracked(() => session.playSound(sound.firmware_id!));
          return {
            state: "dispatched",
            confirmation: "ack",
            evidence: { did: packet.did, cid: packet.cid, sequence: packet.seq },
          };
        },
      };
    }
    if (action === "lights.apply") {
      const command = lightCommand(parameters, config.preferences),
        mask = command.data[0] * 256 + command.data[1];
      const wireOrder = [0, 1, 2, 6, 3, 4, 5, 7],
        resolved: Record<string, number> = {};
      let valueIndex = 2;
      wireOrder.forEach((channel, bit) => {
        if (mask & (1 << bit))
          resolved[LIGHT_SETTING_CHANNELS[channel]] = command.data[valueIndex++];
      });
      return {
        parameters: {
          ...(parameters.preset_id === undefined ? {} : { preset_id: parameters.preset_id }),
          resolved_settings: resolved,
        },
        execute: async () => {
          ready();
          const packet = await tracked(() => session.executeManual(command));
          return {
            state: "dispatched",
            confirmation: "ack",
            evidence: { did: packet.did, cid: packet.cid, sequence: packet.seq },
          };
        },
      };
    }
    if (action === "protocol.run") {
      if (
        Object.keys(parameters).some((key) => !["protocol_id", "recipe"].includes(key)) ||
        parameters.protocol_id !== DEVICE_LIGHT_PROTOCOL_ID
      )
        throw Error(
          "Unknown or unavailable protocol; only vetted light-only protocols are supported",
        );
      const recipe = "recipe" in parameters
        ? parseDeviceLightFile(JSON.stringify(parameters.recipe))
        : deviceLightProtocol(config.preferences);
      return {
        parameters: {
          protocol_id: DEVICE_LIGHT_PROTOCOL_ID,
          resolved_recipe: JSON.parse(JSON.stringify(recipe)),
        },
        execute: async () => {
          ready();
          await tracked(() => session.runDeviceLightRecipe(recipe));
          return {
            state: "dispatched",
            confirmation: "ack",
            evidence: { cleanup_acknowledged: true, physical_completion: false },
          };
        },
      };
    }
    if (
      action === "animation.play" ||
      action === "path.run" ||
      /drive|dome|stance|motion|ram/i.test(action)
    )
      throw Error(MOTION_UNAVAILABLE);
    throw Error("Unknown semantic action");
  };
  const runtime: DroidRuntime = {
    snapshot,
    subscribe(listener) {
      listener(snapshot());
      return session.store.subscribe(() => listener(snapshot()));
    },
    catalogs: (kind) => catalog(kind, config.preferences),
    busy: () =>
      pending > 0 ||
      (!!controller && controller.state !== "disconnected" && controller.hasOngoingActivity) ||
      !!session.store.getSnapshot().activity.source,
    connect: async () => {
      usable();
      const state = session.store.getSnapshot().state;
      if (state === "ready") return;
      if (pending || !["disconnected", "sleeping"].includes(state))
        throw Error("Connection transition already in progress");
      sleepConfirmed = false;
      connecting = true;
      connectionWork = tracked(() => session.reconnectDroid(config.id, services));
      try {
        await connectionWork;
      } finally {
        connecting = false;
        connectionWork = undefined;
        if (releaseAfterConnection) {
          releaseAfterConnection = false;
          if (!disposed && owners.get(config.id) === token) owners.delete(config.id);
        }
      }
    },
    disconnect: async () => {
      ready();
      try {
        await tracked(async () => {
          await session.sleep();
          if (!transportClose) throw Error("Sleep transport close was not observed");
          await transportClose;
        });
      } catch (error) {
        session.fail(
          `Sleep failed or unconfirmed: ${String(error)}. Physical state remains unconfirmed.`,
        );
        throw error;
      }
    },
    stop,
    prepare,
    execute: async (action, parameters) => prepare(action, parameters).execute(),
    dispose: () => {
      if (disposalWork) return disposalWork;
      disposed = true;
      disposalWork = (async () => {
        try {
          // Intent cancellation also covers selection before a controller exists.
          await session.disconnect();
          await connectionWork?.catch(() => {});
          await transportClose;
        } finally {
          detachFault();
          detachPower();
          if (owners.get(config.id) === token) owners.delete(config.id);
        }
      })();
      return disposalWork;
    },
  };
  return runtime;
}
