import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Row } from "../../shared/contracts.js";
export type TestState = "preflight" | "rejected" | "requested" | "passed" | "failed" | "unknown";
// One durable record per operation; response precedes interpretation. The
// rename is atomic, flush precedes rename, and an unfinished request is never replayed.
export class TestJournal {
  readonly id = randomUUID();
  readonly file: string;
  record: Row;
  constructor(runtime: string, initial: Row) {
    const directory = path.join(runtime, "unity-tests");
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, this.id + ".json");
    this.record = { ...initial, id: this.id, state: "preflight", createdAt: new Date().toISOString() };
    this.update({});
  }
  update(change: Row) {
    const next = { ...this.record, ...change, updatedAt: new Date().toISOString() };
    const temp = this.file + ".tmp";
    const fd = fs.openSync(temp, "w");
    try { fs.writeFileSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file); this.record = next;
  }
}
export function readTestRecord(runtime: string, id: string, executionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("无效测试记录标识");
  const file = path.join(runtime, "unity-tests", id + ".json");
  if (fs.lstatSync(file).isSymbolicLink()) throw Error("测试记录不能是链接");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  if (record.executionId !== executionId || record.id !== id) throw Error("测试记录与执行不匹配");
  return record;
}
export class TestFailure extends Error {
  constructor(message: string, public testRunId: string, public testState: TestState) { super(message); }
}
