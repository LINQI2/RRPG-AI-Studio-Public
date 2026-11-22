import { DatabaseSync, backup } from "node:sqlite";
import { EventEmitter } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { now, StudioError, type Row } from "../shared/contracts.js";
export const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const tables = [
  "agents",
  "messages",
  "tasks",
  "decisions",
  "runs",
  "items",
  "receipts",
  "handoffs",
  "settings",
  "requests",
  "deliveries",
  "record_annotations",
  "executions",
  "execution_events",
] as const;
type Table = (typeof tables)[number];
export class Store extends EventEmitter {
  db: DatabaseSync;
  private executionActivityRow = 0;
  private executionActivityTimes = new Map<string, number>();
  constructor(public filename: string) {
    super();
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      "BEGIN; CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL); INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version); COMMIT;",
    );
    if (
      (this.db.prepare("SELECT version FROM schema_version").get() as Row)
        .version !== 1
    )
      throw Error("Unsupported database schema");
    for (const t of tables)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${t}(id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, dedupe TEXT UNIQUE, type TEXT NOT NULL, data TEXT NOT NULL, observed_at TEXT NOT NULL)",
    );
  }
  get(t: Table, id: string): Row | undefined {
    const row = this.db.prepare(`SELECT data FROM ${t} WHERE id=?`).get(id) as
      Row | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  all(t: Table): Row[] {
    return (this.db.prepare(`SELECT data FROM ${t}`).all() as Row[]).map((r) =>
      JSON.parse(r.data),
    );
  }
  executionActivity(): Map<string, number> {
    // Native timestamps survive replay/recovery. Record updatedAt or receipt
    // time would make old events look like new work. Transport acknowledgements
    // alone are not development activity. Return no message/tool payloads.
    // execution_events is an append-only journal. Read only new rows after the
    // initial scan; SSE refreshes must not rescan large historical payloads.
    const rows = this.db.prepare(`SELECT rowid AS cursor, json_extract(data,'$.executionId') AS id,
      json_extract(data,'$.event.time') AS time, json_extract(data,'$.event.type') AS type
      FROM execution_events WHERE rowid > ? ORDER BY rowid`).all(this.executionActivityRow) as Row[];
    for (const r of rows) {
      this.executionActivityRow = r.cursor;
      if (typeof r.id !== 'string' || typeof r.type !== 'string' || r.type.startsWith('session-log-') ||
          !Number.isFinite(r.time) || r.time <= 0 || r.time > 8640000000000000) continue;
      this.executionActivityTimes.set(r.id, Math.max(this.executionActivityTimes.get(r.id) || 0, r.time));
    }
    return new Map(this.executionActivityTimes);
  }
  put(t: Table, r: Row) {
    this.db
      .prepare(
        `INSERT INTO ${t}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(r.id, JSON.stringify(r));
    return r;
  }
  event(type: string, data: Row, dedupe: string = randomUUID()) {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO events(dedupe,type,data,observed_at) VALUES(?,?,?,?)",
      )
      .run(dedupe, type, JSON.stringify(data), now());
    return result.changes ? Number(result.lastInsertRowid) : 0;
  }
  atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    for (const listener of this.listeners("changed"))
      try {
        listener();
      } catch {
        /* An observer failure cannot undo a committed transaction. */
      }
    return result;
  }
  events(after = 0, limit = 500): Row[] {
    return (
      this.db
        .prepare("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?")
        .all(after, limit) as Row[]
    ).map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  cursor() {
    return Number(
      (
        this.db
          .prepare("SELECT COALESCE(MAX(seq),0) AS n FROM events")
          .get() as Row
      ).n,
    );
  }
  create(t: Table, data: Row) {
    const r = {
      ...data,
      id: data.id || randomUUID(),
      createdAt: now(),
      updatedAt: now(),
    };
    this.atomic(() => {
      this.put(t, r);
      this.event(`${t}.created`, r);
    });
    return r;
  }
  update(t: Table, id: string, patch: Row): Row {
    const row = this.get(t, id);
    if (!row) throw new StudioError("Record not found", 404);
    const r = { ...row, ...patch, id, updatedAt: now() };
    this.atomic(() => {
      this.put(t, r);
      this.event(`${t}.updated`, r);
    });
    return r;
  }
  async backup(target: string) {
    await backup(this.db, target);
    return target;
  }
  close() {
    this.db.close();
  }
}
