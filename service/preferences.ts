import type { OperationStore } from "./store.ts";
import type { PreferenceStore } from "../app/session/types.ts";

export function privateRuntimeKey(key: string) {
  return (
    key.startsWith("service.") ||
    ["connection.lifecycle.v1", "battery.profiling.v1"].includes(key)
  );
}

/** Transport bookkeeping must neither invalidate user drafts nor be cleared by them. */
export function runtimePreferences(store: OperationStore, id: string): PreferenceStore {
  const bucket = (key: string) => (privateRuntimeKey(key) ? "$runtime:" + id : id);
  return {
    load: (key) => store.preferences(bucket(key)).values[key] ?? null,
    save: (key, value) => {
      const name = bucket(key);
      const previous = store.preferences(name);
      store.savePreferences(name, previous.revision, { ...previous.values, [key]: value });
    },
  };
}
