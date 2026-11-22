import { it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Store } from "../src/server/db.js";
import { appRoot, configuration } from "../src/server/config.js";
import { DshExecutor, type DshFactory } from "../src/server/dsh/executor.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((f) => f());
});
function setup(factory?: DshFactory, allowed = true) {
  const dir = fs.mkdtempSync(path.join(appRoot, "runtime/tests/dsh-"));
  const db = new Store(path.join(dir, "db.sqlite"));
  cleanup.push(() => db.close());
  const policy = {
    allowed,
    source: "simulated" as const,
    reason: "协议模拟，非真实模型通过",
    maxRuntimeMs: 1000,
    maxOutputTokens: 2048,
  };
  const executor = new DshExecutor(
    db,
    { ...configuration(), runtime: dir },
    policy,
    factory,
  );
  const task = (owner = "developer") =>
    db.create("tasks", {
      owner,
      executor: "dsh",
      purpose: "product",
      status: "pending",
    });
  return { db, executor, task, dir };
}
const input = (key = "request-first") => ({
  instruction: "仅测试协议，不实际调用模型",
  clientRequestId: key,
});
const stage = (id: string, extra = {}) => ({
  id,
  title: id,
  instruction: "协议模拟阶段",
  ...extra,
});
it("host verification time does not consume the next model stage budget", async () => {
  let seq = 0;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize") return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/wait") {
        await new Promise(resolve => setTimeout(resolve, 10));
        event("session.event", { sessionId: job.sessionId, event: { seq: seq++, type: "turn/end", data: { reason: { kind: "completed" } } } });
      }
      return {};
    }, close: async () => {},
  }));
  executor.policy.maxRuntimeMs = 100;
  (executor as any).verifyStage = async () => { await new Promise(resolve => setTimeout(resolve, 150)); return { passed: true }; };
  const job = executor.request(task().id, { ...input("separate-budgets"), stages: [stage("first"), stage("next")] });
  await executor.drain();
  expect(db.get("executions", job.id)?.stages.map((s: any) => s.state)).toEqual(["completed", "completed"]);
});
it("optional stages use one native session, low initialization and one final callback", async () => {
  let seq = 0,
    notices = 0,
    closes = 0;
  const sessions: string[] = [],
    calls: string[] = [];
  let init: any;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m, p) => {
      calls.push(m);
      if (m === "initialize") {
        init = p;
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      }
      if (m === "session/prompt") {
        sessions.push(p.sessionId);
        return { messageId: "m" + seq };
      }
      if (m === "session/wait")
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: seq++,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      return {};
    },
    close: async () => {
      closes++;
    },
  }));
  executor.onSettled = () => {
    notices++;
  };
  const job = executor.request(task().id, {
    ...input(),
    reasoningEffort: "low",
    maxTokens: 8192,
    stages: [stage("inspect"), stage("report")],
  });
  await executor.drain();
  const result = db.get("executions", job.id)!;
  expect(init).toMatchObject({ reasoningEffort: "low", maxTokens: 8192 });
  expect(calls).toEqual([
    "initialize",
    "session/prompt",
    "session/wait",
    "session/prompt",
    "session/wait",
  ]);
  expect(new Set(sessions).size).toBe(1);
  expect(notices).toBe(1);
  expect(closes).toBe(1);
  expect(result.stages.map((s: any) => s.state)).toEqual([
    "completed",
    "completed",
  ]);
  expect(result.stages[0].checkpoint.mode).toBe("execution-only");
  expect(result.validation).toBe("not_verified");
});
it("later max-tokens preserves prior checkpoint, never sends the next stage or disguises failure", async () => {
  let seq = 0,
    prompts = 0;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/prompt") {
        prompts++;
        return { messageId: "m" + prompts };
      }
      if (m === "session/wait")
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: seq++,
            type: "turn/end",
            data: {
              reason: { kind: prompts === 1 ? "completed" : "max-tokens" },
            },
          },
        });
      return {};
    },
    close: async () => {},
  }));
  const j = executor.request(task().id, {
    ...input(),
    stages: [stage("one"), stage("two"), stage("three")],
  });
  await executor.drain();
  const r = db.get("executions", j.id)!;
  expect(prompts).toBe(2);
  expect(r.status).toBe("failed");
  expect(r.stages.map((s: any) => s.state)).toEqual([
    "completed",
    "failed",
    "pending",
  ]);
  expect(r.stages[0].checkpoint.passed).toBe(true);
});
it("missing evidence blocks stage progression even if the native model completed", async () => {
  let prompts = 0;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/prompt") {
        prompts++;
        return { messageId: "m" };
      }
      if (m === "session/wait")
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: 0,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      return {};
    },
    close: async () => {},
  }));
  const j = executor.request(task().id, {
    ...input(),
    stages: [
      stage("one", { check: { kind: "artifact", path: "not-there.txt" } }),
      stage("two"),
    ],
  });
  await executor.drain();
  expect(prompts).toBe(1);
  expect(db.get("executions", j.id)?.status).toBe("failed");
  expect(executor.reconcile(j.id).status).toBe("failed");
});
it("omitted default or explicit null sends no maxTokens to native initialize and resume", async () => {
  const params: any[] = []; let seq = 0;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (method, input: any) => {
      if (method === "initialize") { params.push(input); return { serverInfo: { name: "deepseek-harness-sdk-runtime" } }; }
      if (method === "session/wait") event("session.event", { sessionId: job.sessionId,
        event: { seq: seq++, type: "turn/end", data: { reason: { kind: "completed" } } } });
      return {};
    }, close: async () => {},
  }));
  delete executor.policy.maxOutputTokens;
  const a = executor.request(task().id, input("native-default"));
  await executor.drain(); expect(db.get("executions", a.id)?.outputCap).toBeNull();
  executor.policy.maxOutputTokens = 2048;
  const b = executor.request(task().id, { ...input("explicit-null"), maxTokens: null });
  await executor.drain(); await executor.recover(b.id);
  expect(params).toHaveLength(3);
  for (const p of params) expect(Object.hasOwn(p, "maxTokens")).toBe(false);
  expect(executor.policy.maxOutputTokens).toBe(2048);
});
it("native initialize uses a recorded task-specific output cap without changing policy", async () => {
  let cap = 0;
  const { executor, task } = setup(async (job) => {
    job.outputCap = 8192; // Operator factory, never model-controlled input.
    return {
      request: async (method, params: any) => {
        if (method === "initialize") {
          cap = params.maxTokens;
          return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
        }
        return {};
      },
      close: async () => {},
    };
  });
  executor.request(task().id, input());
  await executor.drain();
  expect(cap).toBe(8192);
  expect(executor.policy.maxOutputTokens).toBe(2048);
});
it("idempotent submission cannot launch twice or change content", async () => {
  let starts = 0;
  const { executor, task } = setup(async () => {
    starts++;
    return { request: async () => ({}), close: async () => {} };
  });
  const t = task(),
    a = executor.request(t.id, input());
  expect(executor.request(t.id, input()).id).toBe(a.id);
  expect(() =>
    executor.request(t.id, { ...input(), instruction: "changed" }),
  ).toThrow("冲突");
  await executor.drain();
  expect(starts).toBe(1);
});
it("disabled executor records a truthful block without model invocation", () => {
  const { executor, task } = setup(undefined, false);
  expect(executor.request(task().id, input())).toMatchObject({
    status: "blocked",
    validation: "not_verified",
    executionSource: "simulated",
  });
});
it("two independent native sessions overlap; third job and foreign actor rejected", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sessions: string[] = [];
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/prompt") {
        sessions.push(job.sessionId);
        return { messageId: job.id };
      }
      if (m === "session/wait") {
        await gate;
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: 2,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      }
      return {};
    },
    close: async () => {},
  }));
  const t1 = task(),
    t2 = task(),
    t3 = task();
  expect(() => executor.request(t1.id, input(), "planner")).toThrow("负责人");
  const a = executor.request(t1.id, input("request-one")),
    b = executor.request(t2.id, input("request-two"));
  expect(() => executor.request(t3.id, input("request-three"))).toThrow("两个");
  await new Promise((r) => setTimeout(r, 10));
  expect(new Set(sessions).size).toBe(2);
  release();
  await executor.drain();
  expect(db.get("executions", a.id)?.status).toBe("finished_unverified");
  expect(db.get("executions", b.id)?.validation).toBe("not_verified");
  expect(db.get("tasks", t1.id)?.status).toBe("pending");
});
it.each(["max-tokens", "error", "blocked", "aborted"])(
  "native %s is not completion",
  async (kind) => {
    const { executor, task, db } = setup(async (job, event) => ({
      request: async (m) => {
        if (m === "initialize")
          return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
        if (m === "session/wait")
          event("session.event", {
            sessionId: job.sessionId,
            event: { seq: 1, type: "turn/end", data: { reason: { kind } } },
          });
        return {};
      },
      close: async () => {},
    }));
    const j = executor.request(task().id, input());
    await executor.drain();
    expect(db.get("executions", j.id)?.status).toBe("failed");
  },
);
it("idle, wait reply and descendant completion are insufficient evidence", async () => {
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/wait") {
        event("session.status", { sessionId: job.sessionId, status: "idle" });
        event("session.event", {
          sessionId: "child",
          event: {
            seq: 1,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      }
      return {};
    },
    close: async () => {},
  }));
  const j = executor.request(task().id, input());
  await executor.drain();
  expect(db.get("executions", j.id)?.status).toBe("unknown");
  expect(() => executor.request(j.taskId, input("next-request"))).toThrow(
    "尚未解决",
  );
});
it("lost prompt acknowledgment stays unknown and restart does not resend", async () => {
  let calls = 0;
  const { executor, task, db, dir } = setup(async () => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      calls++;
      throw Error("connection lost");
    },
    close: async () => {},
  }));
  const j = executor.request(task().id, input());
  await executor.drain();
  expect(db.get("executions", j.id)?.status).toBe("unknown");
  new DshExecutor(db, { ...configuration(), runtime: dir });
  expect(calls).toBe(1);
});
it("legacy and unauthorized task purposes cannot enter DSH", () => {
  const { executor, db } = setup();
  const t = db.create("tasks", { owner: "developer", status: "pending" });
  expect(() => executor.request(t.id, input())).toThrow("旧 Codex");
  db.update("tasks", t.id, { executor: "dsh", purpose: "unknown" });
  expect(() => executor.request(t.id, input())).toThrow("研发");
});
it("native Session recovery uses resume without prompt and keeps unknown outcome", async () => {
  const calls: string[] = [];
  const { executor, db, task } = setup(async () => ({
    request: async (m) => {
      calls.push(m);
      return {};
    },
    close: async () => {},
  }));
  const j = db.create("executions", {
    taskId: task().id,
    owner: "developer",
    status: "unknown",
    sessionId: "existing-native-session",
    workspace: appRoot,
  });
  const r = await executor.recover(j.id);
  expect(r.nativeResume).toBe("confirmed");
  expect(r.status).toBe("unknown");
  expect(calls).toEqual(["initialize", "session/resume"]);
});
it("stale terminal from an earlier stage cannot finish a later stage", async () => {
  let prompts = 0;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/prompt") {
        prompts++;
        return { messageId: "m" + prompts };
      }
      if (m === "session/wait" && prompts === 1)
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: 2,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      return {};
    },
    close: async () => {},
  }));
  const j = executor.request(task().id, {
    ...input(),
    stages: [stage("one"), stage("two"), stage("three")],
  });
  await executor.drain();
  const r = db.get("executions", j.id)!;
  expect(prompts).toBe(2);
  expect(r.status).toBe("unknown");
  expect(r.stages.map((s: any) => s.state)).toEqual([
    "completed",
    "unknown",
    "pending",
  ]);
});
it("overall deadline stops a hanging stage, closes SDK and preserves prior checkpoint", async () => {
  let prompts = 0,
    seq = 0,
    closed = 0;
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/prompt") {
        prompts++;
        return { messageId: "m" };
      }
      if (m === "session/wait") {
        if (prompts === 2) return new Promise(() => {});
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: seq++,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      }
      return {};
    },
    close: async () => {
      closed++;
    },
  }));
  executor.policy.maxRuntimeMs = 80;
  const j = executor.request(task().id, {
    ...input(),
    stages: [stage("one"), stage("two"), stage("three")],
  });
  await executor.drain();
  const r = db.get("executions", j.id)!;
  expect(r.status).toBe("unknown");
  expect(r.stages[0].checkpoint.passed).toBe(true);
  expect(r.stages[2].state).toBe("pending");
  expect(closed).toBe(1);
  expect(prompts).toBe(2);
});
it("restart retains completed checkpoint and uncertain stage without sending prompt", () => {
  const { executor, task, db, dir } = setup();
  const j = db.create("executions", {
    taskId: task().id,
    status: "running",
    stages: [
      { id: "done", state: "completed", checkpoint: { sha256: "saved" } },
      { id: "next", state: "running" },
    ],
  });
  new DshExecutor(db, { ...configuration(), runtime: dir });
  const r = db.get("executions", j.id)!;
  expect(r.status).toBe("unknown");
  expect(r.stages[0].checkpoint.sha256).toBe("saved");
  expect(executor.active.size).toBe(0);
});
it("cancelling between stages preserves evidence and never dispatches the next stage", async () => {
  let prompts = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { executor, task, db } = setup(async (job, event) => ({
    request: async (m) => {
      if (m === "initialize")
        return { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
      if (m === "session/prompt") {
        prompts++;
        return { messageId: "m" };
      }
      if (m === "session/wait") {
        await gate;
        event("session.event", {
          sessionId: job.sessionId,
          event: {
            seq: 0,
            type: "turn/end",
            data: { reason: { kind: "completed" } },
          },
        });
      }
      return {};
    },
    close: async () => {
      release();
    },
  }));
  const j = executor.request(task().id, {
    ...input(),
    stages: [stage("one"), stage("two")],
  });
  while (!executor.connections.size) await new Promise((r) => setTimeout(r, 1));
  executor.cancel(j.id);
  release();
  await executor.drain();
  expect(db.get("executions", j.id)?.status).toBe("cancelled");
  expect(db.get("executions", j.id)?.stages[1].state).toBe("pending");
  expect(prompts).toBeLessThanOrEqual(1);
});
it("Unity preflight rejection never starts SDK or paid model and always attempts cleanup", async () => {
  const { db, dir, task } = setup();
  let sdk = 0,
    release = 0;
  const environment = {
    check: () => {},
    prepare: async () => {
      throw Error("非回环监听");
    },
    release: async () => {
      release++;
    },
    recover: async () => {},
  };
  const ex = new DshExecutor(
    db,
    { ...configuration(), runtime: dir },
    {
      allowed: true,
      source: "simulated",
      reason: "fixture",
      maxRuntimeMs: 1000,
      maxOutputTokens: 2048,
    },
    async () => {
      sdk++;
      throw Error("must not be reached");
    },
    undefined,
    undefined,
    environment,
  );
  await ex.ready;
  const t = task();
  db.update("tasks", t.id, { useUnity: true });
  const j = ex.request(t.id, input());
  await ex.drain();
  expect(sdk).toBe(0);
  expect(release).toBe(1);
  expect(db.get("executions", j.id)?.status).toBe("failed");
  expect(db.get("executions", j.id)?.unity.error).toContain("非回环");
});
it("project-wide reservation rejects another Unity task while ordinary independent work remains possible", async () => {
  const { db, dir, task } = setup();
  let done!: () => void;
  const gate = new Promise<void>((r) => (done = r));
  const env = {
    check: () => {},
    prepare: async () => gate,
    release: async () => {},
    recover: async () => {},
  };
  const ex = new DshExecutor(
    db,
    { ...configuration(), runtime: dir },
    {
      allowed: true,
      source: "simulated",
      reason: "fixture",
      maxRuntimeMs: 1000,
      maxOutputTokens: 2048,
    },
    async () => ({
      request: async (m) =>
        m === "initialize"
          ? { serverInfo: { name: "deepseek-harness-sdk-runtime" } }
          : {},
      close: async () => {},
    }),
    undefined,
    undefined,
    env,
  );
  await ex.ready;
  const a = task(),
    b = task();
  for (const t of [a, b]) db.update("tasks", t.id, { useUnity: true });
  ex.request(a.id, input("unity-one"));
  expect(() => ex.request(b.id, input("unity-two"))).toThrow("同一Unity");
  done();
  await ex.drain();
});
it("failed Unity cleanup retains unknown state and blocks subsequent Unity task instead of claiming cancellation", async () => {
  const { db, dir, task } = setup();
  const env = {
    check: () => {},
    prepare: async () => {},
    release: async () => {
      throw Error("user editor busy");
    },
    recover: async () => {},
  };
  const ex = new DshExecutor(
    db,
    { ...configuration(), runtime: dir },
    {
      allowed: true,
      source: "simulated",
      reason: "fixture",
      maxRuntimeMs: 1000,
      maxOutputTokens: 2048,
    },
    async () => ({
      request: async (m) =>
        m === "initialize"
          ? { serverInfo: { name: "deepseek-harness-sdk-runtime" } }
          : {},
      close: async () => {},
    }),
    undefined,
    undefined,
    env,
  );
  await ex.ready;
  const t = task();
  db.update("tasks", t.id, { useUnity: true });
  const j = ex.request(t.id, input());
  await ex.drain();
  expect(db.get("executions", j.id)).toMatchObject({
    status: "unknown",
    unity: { state: "cleanup_required" },
  });
  const b = task();
  db.update("tasks", b.id, { useUnity: true });
  expect(() => ex.request(b.id, input("after-cleanup-failure"))).toThrow(
    "同一Unity",
  );
});
