import { it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Store } from "../src/server/db.js";
import { configuration, appRoot } from "../src/server/config.js";
import { DshExecutor, type DshFactory } from "../src/server/dsh/executor.js";
import type { WorkspaceLifecycle } from "../src/server/dsh/workspace.js";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const input = (key = "managed-one") => ({
  instruction: "协议模拟，非模型或隔离实测",
  clientRequestId: key,
  shellMode: "managed",
});
async function setup(
  options: {
    cleanupError?: boolean;
    prepareError?: boolean;
    gate?: Promise<void>;
    recoveryError?: boolean;
    factory?: DshFactory;
  } = {},
) {
  const runtime = fs.mkdtempSync(path.join(appRoot, "runtime/tests/managed-"));
  const db = new Store(path.join(runtime, "db.sqlite"));
  stores.push(db);
  const trace: string[] = [];
  const lifecycle: WorkspaceLifecycle = {
    recover: async () =>
      options.recoveryError
        ? [{ sessionId: "old", error: "manual-review" }]
        : [],
    prepare: async () => {
      trace.push("prepare");
      if (options.gate) await options.gate;
      if (options.prepareError) throw Error("ACL refused");
    },
    cleanup: async () => {
      trace.push("cleanup");
      if (options.cleanupError) throw Error("tag restore failed");
    },
  };
  const factory: DshFactory =
    options.factory ??
    (async (job, event) => {
      trace.push("factory");
      return {
        request: async (m) => {
          trace.push(m);
          if (m === "initialize")
            return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
          if (m === "session/wait")
            event("session.event", {
              sessionId: job.sessionId,
              event: {
                seq: 1,
                type: "turn/end",
                data: { reason: { kind: "completed" } },
              },
            });
          return {};
        },
        close: async () => {
          trace.push("close");
        },
      };
    });
  const e = new DshExecutor(
    db,
    { ...configuration(), runtime },
    {
      allowed: true,
      source: "simulated",
      reason: "test-only",
      maxOutputTokens: 32,
      maxRuntimeMs: 500,
      managedShell: true,
    },
    factory,
    lifecycle,
  );
  await e.ready;
  const task = () =>
    db.create("tasks", {
      executor: "dsh",
      purpose: "product",
      owner: "developer",
      status: "pending",
    });
  return { e, db, trace, task };
}
it("prepares once, closes SDK before releasing rights, never equates native finish with acceptance", async () => {
  const { e, db, trace, task } = await setup();
  const t = task(),
    j = e.request(t.id, input());
  expect(e.request(t.id, input()).id).toBe(j.id);
  await e.drain();
  expect(trace).toEqual([
    "prepare",
    "factory",
    "initialize",
    "session/prompt",
    "session/wait",
    "close",
    "cleanup",
  ]);
  expect(db.get("executions", j.id)).toMatchObject({
    permissionState: "released",
    status: "finished_unverified",
    validation: "not_verified",
  });
  expect(db.get("tasks", t.id)?.status).toBe("pending");
});
it("preparation refusal never calls model and still attempts bounded recovery", async () => {
  const { e, db, task, trace } = await setup({ prepareError: true });
  const j = e.request(task().id, input());
  await e.drain();
  expect(trace).toEqual(["prepare", "cleanup"]);
  expect(db.get("executions", j.id)).toMatchObject({
    status: "failed",
    permissionState: "released",
  });
});
it("cleanup failure quarantines managed execution; duplicate lookup remains safe", async () => {
  const { e, db, task } = await setup({ cleanupError: true });
  const t = task(),
    j = e.request(t.id, input());
  await e.drain();
  expect(db.get("executions", j.id)).toMatchObject({
    permissionState: "recovery_required",
    status: "unknown",
  });
  expect(e.reconcile(j.id).status).toBe("unknown");
  expect(() => e.request(task().id, input("next-managed"))).toThrow(
    "恢复未完成",
  );
  expect(e.request(t.id, input()).id).toBe(j.id);
});
it("cancel while preparing sends no prompt; cleanup precedes cancelled state", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { e, db, task, trace } = await setup({ gate });
  const j = e.request(task().id, input());
  expect(e.cancel(j.id).status).toBe("cancelling");
  expect(e.cancel(j.id, "interrupt").stopRequested).toBe("cancel");
  release();
  await e.drain();
  expect(trace).toEqual(["prepare", "cleanup"]);
  expect(db.get("executions", j.id)).toMatchObject({
    status: "cancelled",
    permissionState: "released",
  });
});
it("close failure does not revoke under potentially live children", async () => {
  const { e, db, task, trace } = await setup({
    factory: async () => ({
      request: async (m) =>
        m === "initialize"
          ? { serverInfo: { name: "deepseek-harness-sdk-runtime" } }
          : {},
      close: async () => {
        throw Error("SDK still alive");
      },
    }),
  });
  const j = e.request(task().id, input());
  await e.drain();
  expect(trace).not.toContain("cleanup");
  expect(db.get("executions", j.id)).toMatchObject({
    permissionState: "recovery_required",
    status: "unknown",
  });
});
it("restart recovers permissions without prompt and blocks on unproved cleanup", async () => {
  const { e, task, trace } = await setup({ recoveryError: true });
  expect(e.health().permissionRecoveryPending).toBe(true);
  expect(trace).toEqual([]);
  expect(() => e.request(task().id, input())).toThrow("恢复未完成");
});
it("malformed execution authorization cannot be silently treated as file-only", async () => {
  const { e, task } = await setup();
  expect(() =>
    e.request(task().id, { ...input(), shellMode: "full-access" }),
  ).toThrow("无效");
});
it("interrupt during SDK startup prevents prompt and releases rights", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    calls: string[] = [];
  const { e, db, task } = await setup({
    factory: async () => ({
      request: async (m) => {
        calls.push(m);
        await gate;
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      },
      close: async () => {
        release();
      },
    }),
  });
  const j = e.request(task().id, input());
  await new Promise((r) => setTimeout(r, 10));
  e.cancel(j.id, "interrupt");
  await e.drain();
  expect(calls).toEqual(["initialize"]);
  expect(db.get("executions", j.id)).toMatchObject({
    status: "interrupted",
    permissionState: "released",
  });
});
