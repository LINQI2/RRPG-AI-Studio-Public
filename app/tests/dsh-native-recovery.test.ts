import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { zstdCompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { appRoot, configuration } from "../src/server/config.js";
import { Store } from "../src/server/db.js";
import { DshExecutor } from "../src/server/dsh/executor.js";
import { readSessionJournal } from "../src/server/dsh/session-journal.js";

function fixture() {
  const runtime = fs.mkdtempSync(path.join(appRoot, "runtime/tests/native-recovery-"));
  const root = path.join(runtime, "project"); fs.mkdirSync(root);
  expect(spawnSync("git", ["init", root], { windowsHide: true }).status).toBe(0);
  fs.writeFileSync(path.join(root, "protected.txt"), "keep");
  fs.writeFileSync(path.join(runtime, "baseline.json"), JSON.stringify({ root, protectedFiles: [{ path: "protected.txt", sha256: createHash("sha256").update("keep").digest("hex") }] }));
  const db = new Store(path.join(runtime, "db.sqlite"));
  const task = db.create("tasks", { owner: "developer", executor: "dsh", purpose: "product", status: "blocked" });
  const home = path.join(runtime, "session-home"), sessionId = "rrpg-dsh-fixture";
  const file = path.join(home, "sessions/fixture", sessionId, "session.v4.jsonl.zstd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows: Record<string, any>[] = [{ type: "session", version: 4, id: sessionId, cwd: root },
    { seq: 0, type: "turn/start", time: 1, data: {} },
    { seq: 1, type: "turn/end", time: 2, data: { reason: { kind: "aborted" } } }];
  const write = (items = rows) => fs.writeFileSync(file, Buffer.concat(items.map(r => zstdCompressSync(Buffer.from(JSON.stringify(r) + "\n")))));
  write();
  const job = db.create("executions", { id: "original", taskId: task.id, owner: "developer", home, sessionId,
    workspace: root, projectAuthorization: "fixture", shellMode: "disabled", useUnity: true,
    permissionState: "not_requested", status: "unknown", sdkExitConfirmed: true, error: "original timeout" });
  const environment: any = { recover: async () => {}, reviewIdle: async () => ({ native: { running: false } }) };
  const executor = new DshExecutor(db, { ...configuration(), runtime, project: root }, {
    allowed: true, source: "simulated", reason: "not real model", maxRuntimeMs: 1000,
    projectWorkspace: { root, authorization: "fixture", taskIds: [task.id], recoveryBaseline: "baseline.json" },
  }, undefined, undefined, undefined, environment);
  return { runtime, root, db, job, executor, environment, write, rows };
}
it("recovers all concatenated native frames, preserves unknown origin and records aborted rather than PASS", async () => {
  const f = fixture(); try {
    await f.executor.ready;
    expect(readSessionJournal(f.job).length).toBe(2);
    const review = await f.executor.reviewUnknown(f.job.id);
    expect(review.safeToContinue).toBe(true);
    expect(f.db.get("executions", f.job.id)).toMatchObject({ status: "failed", modelOutcome: "aborted",
      nativeRecovery: { originalStatus: "unknown", originalError: "original timeout", recoveredSeq: [0, 1] } });
    expect(f.db.all("execution_events").length).toBe(2);
  } finally { f.db.close(); }
});
it("maintenance-only verification is idempotent and never completes the old game execution", async () => {
  const f = fixture(); try {
    await f.executor.ready;
    await f.executor.reviewUnknown(f.job.id);
    f.db.update("executions", f.job.id, { stages: [{ id: "planned", check: { kind: "unity-tests", mode: "EditMode" } }] });
    await expect(f.executor.verifyRecovery(f.job.id, "same-request")).rejects.toThrow("维护");
    fs.writeFileSync(path.join(f.runtime, "maintenance.json"), "{}");
    let calls = 0;
    f.environment.prepare = async (job: any) => { job.unity = { state: "ready" }; };
    f.environment.release = async () => {};
    (f.executor as any).verifyStage = async () => { calls++; return { passed: true, testRunId: "fixture" }; };
    const result = await f.executor.verifyRecovery(f.job.id, "same-request");
    expect(result.state).toBe("passed");
    expect(await f.executor.verifyRecovery(f.job.id, "same-request")).toEqual(result);
    expect(calls).toBe(1);
    expect(f.db.get("executions", f.job.id)?.status).toBe("failed");
  } finally { f.db.close(); }
});
it.each(["busy", "protected", "exit", "conflict", "missing-end", "wrong-identity"])("refuses %s without clearing unknown", async kind => {
  const f = fixture(); try {
    await f.executor.ready;
    if (kind === "busy") f.environment.reviewIdle = async () => { throw Error("TestRunner busy"); };
    if (kind === "protected") fs.writeFileSync(path.join(f.root, "protected.txt"), "changed");
    if (kind === "exit") f.db.update("executions", f.job.id, { sdkExitConfirmed: false });
    if (kind === "conflict") f.db.create("execution_events", { id: "original:0", executionId: "original", event: { seq: 0, type: "wrong" } });
    if (kind === "missing-end") f.write(f.rows.slice(0, 2));
    if (kind === "wrong-identity") f.write([{ ...f.rows[0], id: "other" }, ...f.rows.slice(1)]);
    await expect(f.executor.reviewUnknown(f.job.id)).rejects.toThrow();
    expect(f.db.get("executions", f.job.id)?.status).toBe("unknown");
    expect(f.db.get("executions", f.job.id)?.recoveryReview?.safeToContinue).not.toBe(true);
  } finally { f.db.close(); }
});
