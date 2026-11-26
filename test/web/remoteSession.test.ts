import test from "node:test";
import assert from "node:assert/strict";
import { RemoteSession } from "../../web/remoteSession.ts";
import { SessionStore } from "../../app/session/store.ts";
import { commands } from "../../core/commands.ts";

for (const boundary of ["STOP", "audio STOP", "disconnect/reconnect", "focus return", "selection", "disposal", "transport loss", "connection epoch"]) {
  test(`a protocol awaiting its preference save cannot start after ${boundary}`, async (t) => {
    const f = fixture();
    t.after(() => f.port.dispose());
    f.catalog("protocols", [{ id: "protocol-device-lights", available: true, effects: ["lights"] }]);
    await f.port.selectDroid("r2");
    const held = f.hold("droids/r2/preferences");
    const start = f.port.runDeviceLightRecipe({} as any);
    const outcome = start.then(() => undefined, error => error);
    await held.started;
    if (boundary === "STOP") await f.port.stop();
    else if (boundary === "audio STOP") await f.port.execute(commands.stopAudio());
    else if (boundary === "disconnect/reconnect") {
      await f.port.disconnect();
      await f.port.connect([]);
    }
    else if (boundary === "focus return") {
      f.port.handleWindowBlur(true);
      await f.port.handleWindowFocus();
    } else if (boundary === "selection") await f.port.selectDroid("r3");
    else if (boundary === "transport loss" || boundary === "connection epoch") {
      if (boundary === "transport loss") {
        f.transport("disconnected", 0);
        await f.port.refresh();
      }
      f.transport("ready", boundary === "transport loss" ? 0 : 2);
      await f.port.refresh();
    }
    else f.port.dispose();
    held.release();
    assert.ok(await outcome instanceof Error, "the obsolete start must report cancellation");
    assert.equal(f.requests.filter(request => request.body?.action === "protocol.run").length, 0);
  });
}

test("an explicit STOP notifies registered local cancellations once", async (t) => {
  const f = fixture();
  t.after(() => f.port.dispose());
  await f.port.selectDroid("r2");
  let cancellations = 0;
  f.port.registerCancel(() => { cancellations++; });
  await f.port.stop();
  assert.equal(cancellations, 1);
});

test("a pending droid switch rejects protocol starts and ordinary actions before saving or dispatching", async (t) => {
  const f = fixture();
  t.after(() => f.port.dispose());
  f.catalog("protocols", [{ id: "protocol-device-lights", available: true, effects: ["lights"] }]);
  await f.port.selectDroid("r2");
  const stop = f.hold("ui/release");
  const switchDroid = f.port.selectDroid("r3");
  await stop.started;
  try {
    const before = f.requests.length;
    await assert.rejects(f.port.runDeviceLightRecipe({} as any), /selection/i);
    await assert.rejects(f.port.operation("sound.play", { sound_id: "sound:23" }), /selection/i);
    assert.equal(f.requests.length, before);
  } finally {
    stop.release();
    await switchDroid;
  }
  await f.port.operation("sound.play", { sound_id: "sound:23" });
  assert.equal(f.requests.findLast(request => request.body?.action === "sound.play")?.path,
    "http://fixture/ingress/api/v1/droids/r3/operations");
});

test("a protocol request retains the chosen recipe when another client replaces the saved recipe", async (t) => {
  const f = fixture();
  t.after(() => f.port.dispose());
  f.catalog("protocols", [{ id: "protocol-device-lights", available: true, effects: ["lights"] }]);
  await f.port.selectDroid("r2");
  const recipe = { version: 1, name: "Chosen lights", frames: [
    { atMs: 0, transitionMs: 80, controls: [1, 2, 3, 4, 5, 6, 7, 8] },
  ] };
  const held = f.hold("droids/r2/preferences");
  const start = f.port.runDeviceLightRecipe(recipe);
  await held.started;
  f.externalSave("device.light-recipe.v1", "Another client's recipe");
  recipe.frames[0].controls[0] = 99;
  held.release();
  await start;
  assert.deepEqual(f.requests.find(request => request.body?.action === "protocol.run")?.body.parameters,
    { protocol_id: "protocol-device-lights", recipe: { version: 1, name: "Chosen lights", frames: [
      { atMs: 0, transitionMs: 80, controls: [1, 2, 3, 4, 5, 6, 7, 8] },
    ] } });
});

for (const shared of [false, true]) {
  test(`${shared ? "shared invalidations" : "snapshot notifications"} coalesce while slow reads still publish and resolve`, async () => {
    const f = fixture();
    await f.port.selectDroid("r2");
    f.externalSave("name", "First observed value");
    const suffix = shared ? "droids/r2/preferences" : "droids/r2";
    const firstGate = f.hold(suffix);
    const before = f.requests.filter((request) => request.path.endsWith(suffix)).length;
    const refresh = () => (shared ? f.port.refreshSharedState() : f.port.refresh());
    let firstDone = false;
    const first = refresh().then(() => {
      firstDone = true;
    });
    await firstGate.started;
    f.externalSave("name", "Newer observed value");
    const nextGate = f.hold(suffix);
    const second = refresh();
    const third = refresh();
    try {
      assert.equal(
        f.requests.filter((request) => request.path.endsWith(suffix)).length - before,
        1,
        "notifications during an active read must share one queued read",
      );
      firstGate.release();
      await nextGate.started;
      await new Promise(setImmediate);
      assert.equal(
        firstDone,
        true,
        "the first read must resolve without waiting for later invalidations",
      );
      if (shared) assert.equal(f.port.loadPreference("name"), "First observed value");
      nextGate.release();
      await Promise.all([first, second, third]);
      assert.equal(
        f.requests.filter((request) => request.path.endsWith(suffix)).length - before,
        2,
      );
      if (shared) assert.equal(f.port.loadPreference("name"), "Newer observed value");
    } finally {
      firstGate.release();
      nextGate.release();
      f.port.dispose();
    }
  });
}
test("vetted protocols can finish after sixty seconds without extending ordinary-operation waits", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const session = new SessionStore({ state: "ready", detail: "Ready", packets: [] }).getSnapshot();
  let polls = 0;
  const fetcher = async (input: any) => {
    const path = String(input);
    let value: any = {};
    if (path.endsWith("/operations")) value = { operation_id: "long", state: "accepted" };
    else if (path.endsWith("/operations/long"))
      value = { operation_id: "long", state: ++polls >= 2 ? "completed" : "running" };
    else if (path.endsWith("/preferences")) value = { revision: 0, values: {} };
    else if (path.includes("/catalogs/")) value = { items: [] };
    else value = { droid_id: "r2", name: "R2", session };
    return new Response(JSON.stringify(value));
  };
  const port = new RemoteSession({ base: "https://fixture/api/v1/", fetch: fetcher });
  await port.selectDroid("r2");
  const result = port.operation("protocol.run", { protocol_id: "protocol-device-lights" }).then(
    () => true,
    (error) => error,
  );
  await new Promise(setImmediate);
  t.mock.timers.tick(31000);
  await new Promise(setImmediate);
  t.mock.timers.tick(31000);
  assert.equal(await result, true);
  assert.equal(polls, 2);
  polls = 0;
  const ordinary = port.operation("sound.play", { sound_id: "sound:139" }).then(
    () => undefined,
    (error) => error,
  );
  await new Promise(setImmediate);
  t.mock.timers.tick(31000);
  await new Promise(setImmediate);
  assert.match(String(await ordinary), /running.*not replayed/);
  assert.equal(polls, 1);
  port.dispose();
});
for (const shared of [false, true]) {
  test(`${shared ? "shared" : "snapshot"} queued refresh is discarded on disposal`, async () => {
    const f = fixture();
    await f.port.selectDroid("r2");
    const suffix = shared ? "droids/r2/preferences" : "droids/r2";
    const held = f.hold(suffix);
    const refresh = () => (shared ? f.port.refreshSharedState() : f.port.refresh());
    const before = f.requests.length;
    const first = refresh();
    await held.started;
    const queued = refresh();
    f.port.dispose();
    held.release();
    await Promise.all([first, queued]);
    assert.equal(
      f.requests.length - before,
      shared ? 4 : 1,
      "disposal must not start a queued request",
    );
  });
}
for (const boundary of ["selection", "focus resume", "dispose"]) {
  test(`an obsolete heartbeat failure after ${boundary} cannot pause or fail the current session`, async () => {
    const f = fixture();
    try {
      await f.port.selectDroid("r2");
      const oldBeat = f.hold("ui/heartbeat");
      f.port.start();
      await oldBeat.started;
      if (boundary === "selection") await f.port.selectDroid("r3");
      else if (boundary === "focus resume") {
        f.port.handleWindowBlur(true);
        await f.port.handleWindowFocus();
      } else f.port.dispose();
      const releases = f.requests.filter((request) => request.path.endsWith("/ui/release")).length;
      oldBeat.reject(new Error("Obsolete heartbeat failed"));
      await new Promise(setImmediate);
      await new Promise(setImmediate);
      assert.equal(f.port.store.getSnapshot().state, "ready");
      assert.equal(
        f.requests.filter((request) => request.path.endsWith("/ui/release")).length,
        releases,
        "an old failure must not submit a fresh release for another lifecycle",
      );
      assert.equal(
        f.port.store.getSnapshot().connection.droidId,
        boundary === "selection" ? "r3" : "r2",
      );
    } finally {
      f.port.dispose();
    }
  });
}
test("a current heartbeat failure still pauses control and requests STOP without disconnecting", async () => {
  const f = fixture();
  try {
    await f.port.selectDroid("r2");
    const beat = f.hold("ui/heartbeat");
    f.port.start();
    await beat.started;
    beat.reject(new Error("Current heartbeat failed"));
    await new Promise(setImmediate);
    assert.equal(f.port.store.getSnapshot().state, "failed");
    assert.equal(f.port.store.getSnapshot().safety.canControl, false);
    assert.ok(f.requests.some((request) => request.path.endsWith("/ui/release")));
    assert.ok(!f.requests.some((request) => request.body?.action === "connection.disconnect"));
  } finally {
    f.port.dispose();
  }
});
test("reselecting the same droid keeps its visible heartbeat running", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture();
  try {
    await f.port.selectDroid("r2");
    f.port.start();
    const before = f.requests.filter((request) => request.path.endsWith("/ui/heartbeat")).length;
    await f.port.selectDroid("r2");
    t.mock.timers.tick(1000);
    await new Promise(setImmediate);
    assert.ok(
      f.requests.filter((request) => request.path.endsWith("/ui/heartbeat")).length > before,
    );
  } finally {
    f.port.dispose();
  }
});
test("a failed droid-switch STOP remains blocked on the retained original droid", async () => {
  const f = fixture();
  try {
    await f.port.selectDroid("r2");
    f.port.start();
    f.failStop();
    await assert.rejects(f.port.selectDroid("r3"), /STOP failed/);
    assert.equal(f.port.store.getSnapshot().connection.droidId, "r2");
    assert.equal(f.port.store.getSnapshot().state, "failed");
    assert.equal(f.port.store.getSnapshot().safety.canControl, false);
    const before = f.requests.length;
    await assert.rejects(f.port.operation("led.set"), /paused/);
    assert.equal(f.requests.length, before);
  } finally {
    f.port.dispose();
  }
});
for (const id of ["r2", "r3"]) {
  test(`a failed selection read for ${id} pauses the retained session instead of leaving a ready view without heartbeat`, async () => {
    const f = fixture();
    try {
      await f.port.selectDroid("r2");
      f.port.start();
      const failed = f.hold(`droids/${id}/preferences`);
      const selection = f.port.selectDroid(id);
      await failed.started;
      failed.reject(new Error("Metadata read failed"));
      await assert.rejects(selection, /Metadata read failed/);
      assert.equal(f.port.store.getSnapshot().state, "failed");
      assert.equal(f.port.store.getSnapshot().connection.droidId, "r2");
      assert.equal(f.port.store.getSnapshot().safety.canControl, false);
      assert.ok(f.requests.some((request) => request.path.endsWith("/ui/release")));
    } finally {
      f.port.dispose();
    }
  });
}
test("a newer same-droid selection waits for the pending switch STOP and retains its failure", async () => {
  const f = fixture();
  let gate: ReturnType<typeof f.hold> | undefined;
  try {
    await f.port.selectDroid("r2");
    f.port.start();
    gate = f.hold("ui/release");
    const switching = f.port.selectDroid("r3").then(
      () => undefined,
      (error) => error,
    );
    await gate.started;
    let reselected = false;
    const same = f.port.selectDroid("r2").then(
      () => {
        reselected = true;
      },
      (error) => error,
    );
    await new Promise(setImmediate);
    assert.equal(reselected, false, "selection must not bypass the pending STOP");
    gate.reject(new Error("Switch STOP failed"));
    const [first, second] = await Promise.all([switching, same]);
    assert.match(String(first), /STOP failed/);
    assert.match(String(second), /STOP failed/);
    assert.equal(f.port.store.getSnapshot().state, "failed");
    assert.equal(f.port.store.getSnapshot().connection.droidId, "r2");
    assert.equal(f.port.store.getSnapshot().safety.canControl, false);
  } finally {
    gate?.release();
    f.port.dispose();
  }
});
test("disposal fences a pending selection before it replaces the current cache", async () => {
  const f = fixture();
  try {
    await f.port.selectDroid("r2");
    const gate = f.hold("droids/r3/preferences");
    const selection = f.port.selectDroid("r3");
    await gate.started;
    f.port.dispose();
    gate.release();
    await assert.rejects(selection, /superseded/);
    assert.equal(f.port.store.getSnapshot().connection.droidId, "r2");
  } finally {
    f.port.dispose();
  }
});
function fixture() {
  const gates = new Map<
    string,
    {
      started: () => void;
      wait: Promise<void>;
    }
  >();
  const requests: Array<{
    path: string;
    init: RequestInit;
    body: any;
  }> = [];
  const store = new SessionStore({ state: "ready", detail: "Connected", packets: [] });
  let sessionSnapshot = store.getSnapshot();
  let values: Record<string, string> = {},
    revision = 0,
    failSave = false,
    failStop = false,
    expired = false,
    releaseWait: Promise<void> | undefined;
  let changed: () => void = () => {};
  const catalogs = new Map<string, unknown[]>();
  const fetcher = async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input),
      body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, init, body });
    let result: any = {};
    let status = 200;
    if (path.endsWith("/session")) result = { authenticated: true, csrf_token: "csrf" };
    else if (path.endsWith("/lights/open")) result = {token:"frame-token"};
    else if (path.endsWith("/droids"))
      result = { items: [{ droid_id: "r2", name: "Living room" }] };
    else if (path.endsWith("/preferences")) {
      if (init.method === "PUT") {
        if (failSave || body.revision !== revision) {
          status = 409;
          result = { error: { message: "Revision conflict" } };
        } else {
          values = body.values;
          revision++;
          result = { values, revision };
        }
      } else result = { values, revision };
    } else if (path.includes("/catalogs/"))
      result = { items: catalogs.get(path.split("/").at(-1)!) ?? [], revision };
    else if (path.endsWith("/ui/release")) {
      await releaseWait;
      if (failStop) {
        status = 409;
        result = { error: { message: "STOP failed" } };
      }
    } else if (path.endsWith("/operations")) result = { operation_id: "op", state: "dispatched" };
    else if (path.endsWith("/r2") || path.endsWith("/r3"))
      result = {
        droid_id: path.split("/").at(-1),
        name: "Living room",
        session: sessionSnapshot,
        capabilities: {lightFrames: true},
        revision: 1,
      };
    if (
      expired &&
      (path.endsWith("/ui/release") || (path.endsWith("/session") && init.method === "DELETE"))
    ) {
      status = 401;
      result = { error: { message: "unauthenticated" } };
    }
    const gate = gates.get(path);
    if (gate) {
      gates.delete(path);
      gate.started();
      await gate.wait;
    }
    return new Response(JSON.stringify(result), { status });
  };
  const port = new RemoteSession({
    fetch: fetcher,
    base: "http://fixture/ingress/api/v1/",
    clientId: "test",
    subscribeChanges: (listener) => {
      changed = listener;
      return () => {
        changed = () => {};
      };
    },
  });
  return {
    port,
    requests,
    transport: (state: "ready" | "disconnected", epoch: number) => {
      sessionSnapshot = { ...sessionSnapshot, state,
        connection: { ...sessionSnapshot.connection, state, epoch },
        safety: { ...sessionSnapshot.safety, canControl: state === "ready" },
      };
    },
    notify: () => changed(),
    catalog: (kind: string, items: unknown[]) => catalogs.set(kind, items),
    expire: () => {
      expired = true;
    },
    externalSave: (key: string, value: string) => {
      values = { ...values, [key]: value };
      revision++;
    },
    hold: (suffix: string) => {
      let release!: () => void, started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      let reject!: (error: Error) => void;
      const wait = new Promise<void>((resolve, fail) => {
        release = resolve;
        reject = fail;
      });
      gates.set("http://fixture/ingress/api/v1/" + suffix, { started, wait });
      return { started: waiting, release, reject };
    },
    waitRelease: (value: Promise<void>) => {
      releaseWait = value;
    },
    failSave: () => {
      failSave = true;
    },
    failStop: () => {
      failStop = true;
    },
  };
}
test("shared change notifications refresh preferences and execution catalogs", async (t) => {
  const f = fixture();
  t.after(() => f.port.dispose());
  await f.port.selectDroid("r2");
  f.port.start();
  const before = f.port.store.getSnapshot().preferencesRevision;
  f.externalSave("interfacePreferences", "updated");
  f.catalog("protocols", [{ id: "protocol-device-lights", available: true, effects: ["lights"] }]);
  f.notify();
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(f.port.loadPreference("interfacePreferences"), "updated");
  assert.notEqual(f.port.store.getSnapshot().preferencesRevision, before);
  // Even though a fresh catalog enables the capability, the unseen external
  // write still requires explicit conflict review before replacing preferences.
  await assert.rejects(f.port.savePreference("name", "Draft"), /review/i);
  await f.port.runDeviceLightRecipe({} as any);
  assert.ok(f.requests.some((r) => r.body?.action === "protocol.run"));
});
test("a late shared refresh cannot replace a newer confirmed local save", async () => {
  const f = fixture();
  await f.port.selectDroid("r2");
  const gate = f.hold("droids/r2/preferences");
  const refresh = f.port.refreshSharedState();
  await gate.started;
  await f.port.savePreference("name", "Saved");
  gate.release();
  await refresh;
  assert.equal(f.port.loadPreference("name"), "Saved");
});
test("a shared refresh from the prior selection cannot replace the new droid cache", async () => {
  const f = fixture();
  await f.port.selectDroid("r2");
  const gate = f.hold("droids/r2/preferences");
  const refresh = f.port.refreshSharedState();
  await gate.started;
  f.externalSave("name", "Other droid");
  await f.port.selectDroid("r3");
  gate.release();
  await refresh;
  assert.equal(f.port.store.getSnapshot().connection.droidId, "r3");
  assert.equal(f.port.loadPreference("name"), "Other droid");
});
test("remote startup is read-only and never requests Bluetooth or connection", async () => {
  const { port, requests } = fixture();
  await port.initialize();
  await port.selectDroid("r2");
  assert.equal(port.store.getSnapshot().connection.droidName, "Living room");
  assert.ok(requests.every((r) => !r.init.method || r.init.method === "GET"));
  assert.equal(port.motionAvailable, false);
});
test("remote motion and raw diagnostics fail closed before any HTTP effect", async () => {
  const { port, requests } = fixture();
  await port.initialize();
  await port.selectDroid("r2");
  const count = requests.length;
  assert.throws(() => port.armMotion(), /unavailable/i);
  await assert.rejects(port.execute(commands.drive(20, 0)), /unavailable/i);
  await assert.rejects(port.execute(commands.identity(0)), /unavailable/i);
  assert.equal(requests.length, count);
});
test("shared saves await revision confirmation and conflict never shadows cached value", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  await f.port.savePreference("name", "R2");
  assert.equal(f.port.loadPreference("name"), "R2");
  f.failSave();
  await assert.rejects(f.port.savePreference("name", "Wrong"), /Revision conflict/);
  assert.equal(f.port.loadPreference("name"), "R2");
  const put = f.requests.find((r) => r.init.method === "PUT")!;
  assert.equal(put.body.revision, 0);
  assert.equal(new Headers(put.init.headers).get("X-CSRF-Token"), "csrf");
});
test("focus loss releases server activity without disconnect and failed STOP survives focus/refresh", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  f.failStop();
  f.port.handleWindowBlur(true);
  await f.port.handleWindowFocus();
  await f.port.refresh();
  assert.equal(f.port.store.getSnapshot().state, "failed");
  assert.match(f.port.store.getSnapshot().detail, /STOP failed/);
  assert.equal(f.requests.filter((r) => r.path.endsWith("/ui/release")).length, 1);
  assert.ok(!f.requests.some((r) => r.body?.action === "connection.disconnect"));
  f.port.dispose();
});
test("remote lights preserve channel mapping and send semantic settings with a fresh idempotency key", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  await f.port.execute(commands.leds(0b00011000, [120, 34]));
  const effect = f.requests.find((r) => r.path.endsWith("/operations"))!;
  assert.deepEqual(effect.body.parameters, { settings: { readouts: 120, rear_dome_red: 34 } });
  assert.equal(effect.body.action, "lights.apply");
  assert.ok(new Headers(effect.init.headers).get("Idempotency-Key"));
  assert.ok(!("did" in effect.body));
  assert.ok(!("data" in effect.body));
});
test("unsupported LED masks and unknown sounds never reach service", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  const count = f.requests.length;
  await assert.rejects(f.port.execute(commands.leds(256, [1])), /unavailable/);
  await assert.rejects(f.port.execute(commands.audio(65535)), /unavailable/);
  assert.equal(f.requests.length, count);
});
test("a second blur fences a pending focus resume and never restarts heartbeat", async (t) => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  t.after(() => f.port.dispose());
  let finish!: () => void;
  f.waitRelease(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  f.port.handleWindowBlur(true);
  const resume = f.port.handleWindowFocus();
  f.port.handleWindowBlur(true);
  finish();
  await resume;
  assert.equal(f.port.store.getSnapshot().safety.canControl, false);
  assert.equal(f.port.store.getSnapshot().state, "paused");
  assert.equal(f.requests.filter((r) => r.path.endsWith("/ui/heartbeat")).length, 0);
  f.port.dispose();
});
test("switching the selected droid renews only its visible client heartbeat", async (t) => {
  const f = fixture();
  t.after(() => f.port.dispose());
  await f.port.initialize();
  await f.port.selectDroid("r2");
  f.port.start();
  await f.port.selectDroid("r3");
  const beats = f.requests.filter((r) => r.path.endsWith("/ui/heartbeat"));
  assert.equal(beats.length, 2);
  assert.equal(beats[1].body.droid_id, "r3");
  assert.equal(f.requests.find((r) => r.path.endsWith("/ui/release"))?.body.droid_id, "r2");
});
test("refresh during droid switch cannot replace the selected identity with the old droid", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  let released!: () => void;
  f.waitRelease(
    new Promise<void>((resolve) => {
      released = resolve;
    }),
  );
  const selection = f.port.selectDroid("r3");
  const gate = f.hold("droids/r2");
  const refresh = f.port.refresh();
  await gate.started;
  released();
  await selection;
  gate.release();
  await refresh;
  assert.equal(f.port.store.getSnapshot().connection.droidId, "r3");
  await f.port.execute(commands.leds(1, [50]));
  assert.ok(f.requests.find((r) => r.body?.action === "lights.apply")?.path.includes("/r3/"));
});
test("expired browser authentication can sign out while retaining unconfirmed STOP", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  f.expire();
  const note = await f.port.logout();
  assert.match(note ?? "", /STOP.*unconfirmed/i);
  assert.ok(f.requests.some((r) => r.path.endsWith("/session") && r.init.method === "DELETE"));
  assert.equal(f.port.store.getSnapshot().state, "failed");
});
test("revision conflict refreshes the saved baseline but requires explicit review and retry", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  await f.port.savePreference("name", "A");
  f.externalSave("name", "B");
  await assert.rejects(f.port.savePreference("name", "C"), /review/i);
  assert.equal(f.port.loadPreference("name"), "B");
  await f.port.savePreference("name", "C");
  assert.equal(f.port.loadPreference("name"), "C");
});
test("saves queued before a revision conflict cannot become an automatic retry", async () => {
  const f = fixture();
  await f.port.selectDroid("r2");
  f.externalSave("name", "Other client");
  const first = f.port.savePreference("name", "First stale draft");
  const second = f.port.savePreference("name", "Second stale draft");
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(f.requests.filter((request) => request.init.method === "PUT").length, 1);
  assert.equal(f.port.loadPreference("name"), "Other client");
  await f.port.savePreference("name", "Reviewed fresh retry");
  assert.equal(f.port.loadPreference("name"), "Reviewed fresh retry");
});
test("retained remote runtime migrates new fences without changing identity or clearing failed STOP", async () => {
  const f = fixture();
  await f.port.initialize();
  await f.port.selectDroid("r2");
  f.failStop();
  f.port.handleWindowBlur(true);
  await f.port.handleWindowFocus();
  const id = f.port.clientId;
  for (const key of ["focusGeneration", "selectionGeneration", "refreshGeneration", "running"])
    Reflect.deleteProperty(f.port, key);
  f.port.adoptRetainedState();
  await f.port.refresh();
  assert.equal(f.port.clientId, id);
  assert.equal(f.port.store.getSnapshot().state, "failed");
  assert.ok(!f.requests.some((r) => r.body?.action === "connection.connect"));
  f.port.dispose();
});
test("a rejected shared refresh for the prior droid cannot fail or release the selected droid", async (t) => {
  const f = fixture();
  t.after(() => f.port.dispose());
  await f.port.selectDroid("r2");
  f.port.start();
  const gate = f.hold("droids/r2/preferences");
  f.notify();
  await gate.started;
  await f.port.selectDroid("r3");
  const count = f.requests.length;
  gate.reject(Error("Old droid read failed"));
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(f.port.store.getSnapshot().state, "ready");
  assert.equal(f.port.store.getSnapshot().connection.droidId, "r3");
  assert.ok(!f.requests.slice(count).some((request) => request.path.endsWith("/ui/release")));
});


test("Rainbow frames bypass durable operations and retain focus gates", async t => {
  const f = fixture();
  t.after(() => f.port.dispose());
  f.transport("ready", 1);
  await f.port.selectDroid("r2");
  const frame = commands.leds(0x77, [255,128,0,255,128,0]);
  await f.port.executeLightFrame(frame);
  const sent = f.requests.filter(r => r.path.endsWith("/lights/frame"));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, {client_id:"test", token:"frame-token", rgb:[255,128,0,255,128,0]});
  assert.equal(f.requests.filter(r => r.body?.action === "lights.apply").length, 0);
  await assert.rejects(f.port.executeLightFrame(commands.leds(0xff, [0,0,0,0,0,0,0,0])), /dome-only/);
  f.port.handleWindowBlur(true);
  await assert.rejects(f.port.executeLightFrame(frame), /paused/i);
  await f.port.handleWindowFocus();
  assert.equal(f.requests.filter(r => r.path.endsWith("/lights/frame")).length, 1);
});


test("a light token arriving after focus loss cannot dispatch a frame", async t => {
  const f=fixture(); t.after(()=>f.port.dispose()); f.transport("ready",1);
  await f.port.selectDroid("r2");
  const gate=f.hold("droids/r2/lights/open");
  const result=f.port.executeLightFrame(commands.leds(0x77,[255,0,0,255,0,0])).catch(e=>e);
  await gate.started; f.port.handleWindowBlur(true); await f.port.handleWindowFocus();
  gate.release(); assert.ok(await result instanceof Error);
  assert.equal(f.requests.filter(r=>r.path.endsWith("/lights/frame")).length,0);
});


test("unmount cancellation fences a light frame still waiting for its token", async t => {
  const f=fixture(); t.after(()=>f.port.dispose()); f.transport("ready",1);
  await f.port.selectDroid("r2");
  const gate=f.hold("droids/r2/lights/open"); let current=true;
  const result=f.port.executeLightFrame(commands.leds(0x77,[255,0,0,255,0,0]),()=>current).catch(e=>e);
  await gate.started; current=false; gate.release();
  assert.ok(await result instanceof Error);
  assert.equal(f.requests.filter(r=>r.path.endsWith("/lights/frame")).length,0);
});


test("repeated STOP taps share one operation and a later tap can stop again", async t => {
 const f=fixture();t.after(()=>f.port.dispose());
 await f.port.selectDroid("r2");
 const held=f.hold("droids/r2/operations");
 const first=f.port.stop();await held.started;
 const second=f.port.stop();
 held.release();await Promise.all([first,second]);
 assert.equal(f.requests.filter(r=>r.body?.action==='activity.stop').length,1);
 await f.port.stop();
 assert.equal(f.requests.filter(r=>r.body?.action==='activity.stop').length,2);
});
