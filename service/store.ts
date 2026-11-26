import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
export type Operation = {
  operation_id: string;
  droid_id: string;
  action: string;
  state: string;
  confirmation: string;
  revision: number;
  created_at: string;
  updated_at: string;
  principal: string;
  [key: string]: unknown;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export class OperationStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,principal TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(principal,key));
   CREATE TABLE IF NOT EXISTS preferences (droid TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS cooldown (key TEXT PRIMARY KEY,until_ms INTEGER NOT NULL);`);
    for (const row of this.db.prepare("SELECT id,body FROM operations").all()) {
      const op = JSON.parse(String(row.body)) as Operation;
      if (["accepted", "running", "acknowledged"].includes(op.state))
        this.update(String(row.id), {
          state: "interrupted",
          outcome_uncertain: true,
          reason: "service_restarted",
        });
    }
  }
  instanceId() {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='instance'").get();
    if (row) return String(row.value);
    const id = randomUUID();
    this.db.prepare("INSERT INTO metadata VALUES (?,?)").run("instance", id);
    return id;
  }
  accept(
    principal: string,
    key: string,
    droid: string,
    request: Record<string, unknown>,
    details?: () => Record<string, unknown>,
  ) {
    const digest = createHash("sha256").update(canonical({ droid, request })).digest("hex");
    const prior = this.db
      .prepare("SELECT digest,body FROM operations WHERE principal=? AND key=?")
      .get(principal, key);
    if (prior) {
      if (prior.digest !== digest) throw Error("idempotency conflict");
      return { created: false, operation: JSON.parse(String(prior.body)) as Operation };
    }
    if (Number(this.db.prepare("SELECT count(*) AS n FROM operations").get()!.n) >= 100000)
      throw Error("operation store capacity reached");
    const now = new Date().toISOString();
    const operation: Operation = {
      operation_id: randomUUID(),
      droid_id: droid,
      action: String(request.action),
      state: "accepted",
      confirmation: "none",
      revision: 1,
      created_at: now,
      updated_at: now,
      principal,
      ...details?.(),
    };
    this.db
      .prepare("INSERT INTO operations VALUES (?,?,?,?,?)")
      .run(operation.operation_id, principal, key, digest, JSON.stringify(operation));
    return { created: true, operation };
  }
  get(id: string): Operation | undefined {
    const row = this.db.prepare("SELECT body FROM operations WHERE id=?").get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  update(id: string, patch: Record<string, unknown>): Operation {
    const old = this.get(id);
    if (!old) throw Error("unknown operation");
    const op = {
      ...old,
      ...patch,
      revision: old.revision + 1,
      updated_at: new Date().toISOString(),
    };
    this.db.prepare("UPDATE operations SET body=? WHERE id=?").run(JSON.stringify(op), id);
    return op;
  }
  preferences(droid: string): { revision: number; values: Record<string, string> } {
    const row = this.db.prepare("SELECT revision,body FROM preferences WHERE droid=?").get(droid);
    return row
      ? { revision: Number(row.revision), values: JSON.parse(String(row.body)) }
      : { revision: 0, values: {} };
  }
  savePreferences(droid: string, revision: number, values: Record<string, string>) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.preferences(droid);
      if (old.revision !== revision) throw Error("preference revision conflict");
      this.db
        .prepare(
          "INSERT INTO preferences VALUES (?,?,?) ON CONFLICT(droid) DO UPDATE SET revision=excluded.revision,body=excluded.body",
        )
        .run(droid, revision + 1, JSON.stringify(values));
      this.db.exec("COMMIT");
      return { revision: revision + 1, values };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  claimCooldown(key: string, ms: number) {
    if (!ms) return true;
    const now = Date.now(),
      row = this.db.prepare("SELECT until_ms FROM cooldown WHERE key=?").get(key);
    if (row && Number(row.until_ms) > now) return false;
    this.db
      .prepare(
        "INSERT INTO cooldown VALUES (?,?) ON CONFLICT(key) DO UPDATE SET until_ms=excluded.until_ms",
      )
      .run(key, now + ms);
    return true;
  }
  revokedTokens(): string[] {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='revoked_tokens'").get();
    return row ? JSON.parse(String(row.value)) : [];
  }
  revokeToken(id: string) {
    const ids = [...new Set([...this.revokedTokens(), id])];
    this.db
      .prepare(
        "INSERT INTO metadata VALUES ('revoked_tokens',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(ids));
  }
  close() {
    this.db.close();
  }
}
