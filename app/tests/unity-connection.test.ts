import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appRoot, configuration } from "../src/server/config.js";
import { UnityConnection } from "../src/server/unity/connection.js";
import { unitySettings } from "../src/server/project-config.js";
import { McpToolError } from "../src/server/unity/mcp.js";
import { TestJournal, readTestRecord } from "../src/server/unity/test-journal.js";
function setup(identityPatch: Record<string, any> = {}, response?: any) {
  const runtime = fs.mkdtempSync(path.join(appRoot, "runtime/manual-unity-")),
    project = path.join(runtime, "project");
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(runtime, "credentials"));
  fs.writeFileSync(
    path.join(runtime, "credentials/mcp.json"),
    JSON.stringify({ token: "fixture-not-a-real-secret" }),
  );
  fs.writeFileSync(
    path.join(runtime, "project-config.json"),
    JSON.stringify({
      projectRoot: project,
      unity: {
        enabled: true,
        allowExecution: true,
        endpoint: "http://127.0.0.1:21999/mcp",
        tokenFile: "credentials/mcp.json",
        expectedVersion: "fixture-version",
      },
    }),
  );
  const calls: string[] = [];
  const fake = {
    connect: async () => {
      calls.push("connect");
    },
    call: async () => ({ tools: [{ name: "script-execute" }] }),
    tool: async (name: string, args?: any) => {
      calls.push(name);
      if (args?.className === "StudioTestState") return { running: false, pending: "", activeRequest: "" };
      if (args?.className === "StudioSceneState") return identityPatch.dirtyScene ? "studio-scenes-v1|1|U2FtcGxlU2NlbmU=,1" : "studio-scenes-v1|0|";
      if (args?.className === "StudioTestResourceHook") {
        if (args.csharpCode.includes('GetMethod("Begin"')) return "scope-active|fixture";
        if (identityPatch.resourceCleanupError) throw Error("resource cleanup lost");
        return "scope-restored|fixture";
      }
      if (name === "tests-run") {
        if (response instanceof Error) throw response;
        return response;
      }
      return {
        value: JSON.stringify({
          project,
          version: "fixture-version",
          ...identityPatch,
        }),
      };
    },
  };
  const c = new UnityConnection(
    { ...configuration(), runtime, project },
    () => fake as any,
  );
  const job: any = {
    id: "fixture-execution",
    owner: "developer",
    useUnity: true,
    workspace: runtime,
  };
  return { runtime, project, c, calls, job };
}
it("manual identity check only uses read calls; no launch/close API exists", async () => {
  const { c, calls } = setup();
  expect((await c.inspect()).identity.version).toBe("fixture-version");
  expect(calls).toEqual(["connect", "script-execute"]);
  expect(c.health().automaticStart).toBe(false);
});
it("repository root and a contained Unity project have separate identity roots without widening scope", () => {
  const { runtime, project } = setup();
  const file = path.join(runtime, "project-config.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const unityRoot = path.join(project, "UnityProject", "Game");
  fs.mkdirSync(unityRoot, { recursive: true });
  config.unity.projectPath = "UnityProject/Game";
  fs.writeFileSync(file, JSON.stringify(config));
  const settings = unitySettings({ ...configuration(), runtime, project });
  expect(settings.root).toBe(unityRoot);
  expect(settings.repositoryRoot).toBe(project);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).projectRoot).toBe(project);
  config.unity.projectPath = "../outside";
  fs.writeFileSync(file, JSON.stringify(config));
  expect(() => unitySettings({ ...configuration(), runtime, project })).toThrow("仓库内");
});
it("wrong project or version fails closed", async () => {
  for (const patch of [{ project: "C:/other" }, { version: "other" }]) {
    const { c } = setup(patch);
    await expect(c.inspect()).rejects.toThrow("不符");
  }
});
it("reviewed cleanup only releases the original idle project lease, never another task", async () => {
  const { c, job } = setup();
  await c.prepare(job, () => false);
  await expect(c.releaseReviewed({ ...job, id: "other" })).rejects.toThrow("其他执行");
  expect(fs.existsSync(c.lock)).toBe(true);
  job.unity.testPending = true;
  await c.releaseReviewed(job);
  expect(fs.existsSync(c.lock)).toBe(false);
  expect(job.unity.testPending).toBe(false);
  expect(job.unity.editorClosed).toBe(false);
});
it("exclusive project lock survives restart and releases without closing user editor", async () => {
  const { c, job } = setup();
  await c.prepare(job, () => false);
  expect(() => c.check(job)).toThrow("已有");
  await expect(c.recover()).rejects.toThrow("未知");
  await c.release(job);
  expect(fs.existsSync(c.lock)).toBe(false);
  expect(job.unity.editorClosed).toBe(false);
});
it("busy editor or cancelled preparation sends no test and releases preparation lock", async () => {
  for (const patch of [{ playing: true }, {}]) {
    const { c, job, calls } = setup(patch);
    await expect(c.prepare(job, () => !patch.playing)).rejects.toThrow();
    expect(calls).not.toContain("tests-run");
    expect(fs.existsSync(c.lock)).toBe(false);
  }
});
it("actual result must be nonzero, complete and error-free", async () => {
  const { c, job } = setup(
    {},
    {
      Summary: {
        Status: "Passed",
        TotalTests: 1,
        PassedTests: 1,
        FailedTests: 0,
        SkippedTests: 0,
      },
      Results: [{ Name: "fixture", Status: "Passed" }],
    },
  );
  await c.prepare(job, () => false);
  const checkpoint = await c.verify(job, {
    id: "verify",
    check: { mode: "EditMode", filter: { testClass: "Fixture" } },
  });
  expect(checkpoint.passed).toBe(true);
  expect(checkpoint.mode).toBe("real-unity-tests");
  expect(fs.existsSync(path.join(job.workspace, "UNITY-verify.json"))).toBe(
    true,
  );
  await c.release(job);
});
it("unknown test delivery holds project lock; no automatic repeat or editor termination", async () => {
  const { c, job, calls } = setup({}, new Error("transport lost"));
  await c.prepare(job, () => false);
  await expect(
    c.verify(job, { id: "verify", check: { mode: "EditMode" } }),
  ).rejects.toThrow("lost");
  await expect(c.release(job)).rejects.toThrow("未知");
  expect(fs.existsSync(c.lock)).toBe(true);
  expect(calls.filter((x) => x === "tests-run")).toHaveLength(1);
});
it("dirty scene is rejected before test dispatch, keeps scene and releases the original lease", async () => {
  const { c, job, calls, runtime } = setup({ dirtyScene: true });
  await c.prepare(job, () => false);
  await expect(c.verify(job, { id: "dirty", check: { mode: "EditMode" } })).rejects.toThrow("未保存");
  expect(calls.filter(x => x === "tests-run")).toHaveLength(0);
  const record = readTestRecord(runtime, job.unity.testRunId, job.id);
  expect(record.state).toBe("rejected");
  expect(record.requestedAt).toBeUndefined();
  await c.release(job);
  expect(fs.existsSync(c.lock)).toBe(false);
});
it("server rejection after a clean preflight is not confused with a lost response", async () => {
  const error = new McpToolError("Cannot run tests: unsaved changes", { isError: true });
  const { c, job, runtime } = setup({}, error);
  await c.prepare(job, () => false);
  await expect(c.verify(job, { id: "race", check: { mode: "EditMode" } })).rejects.toThrow("unsaved changes");
  expect(readTestRecord(runtime, job.unity.testRunId, job.id).state).toBe("rejected");
  await c.release(job);
});
it("real failing results are saved before failure is raised and do not leave an unknown lease", async () => {
  const result = { Summary: { Status: "Failed", TotalTests: 1, PassedTests: 0, FailedTests: 1, SkippedTests: 0 }, Results: [{ Name: "expected-test", Status: "Failed", Message: "assertion evidence" }] };
  const { c, job, runtime } = setup({}, result);
  await c.prepare(job, () => false);
  await expect(c.verify(job, { id: "red", check: { mode: "EditMode" } })).rejects.toThrow("验证未通过");
  const record = readTestRecord(runtime, job.unity.testRunId, job.id);
  expect(record).toMatchObject({ state: "failed", result });
  await c.release(job);
  await expect(c.recover()).resolves.toBeUndefined();
});
it("incomplete result remains unknown and blocks recovery even if a process restart loses the lock", async () => {
  const { c, job, runtime } = setup({}, { Summary: { Status: "Passed", TotalTests: 2 }, Results: [] });
  await c.prepare(job, () => false);
  await expect(c.verify(job, { id: "partial", check: { mode: "EditMode" } })).rejects.toThrow();
  expect(readTestRecord(runtime, job.unity.testRunId, job.id).state).toBe("unknown");
  fs.unlinkSync(c.lock); // simulate missing lock, not evidence of a finished test
  await expect(c.recover()).rejects.toThrow("持久测试请求");
  await c.releaseReviewed(job);
  expect(readTestRecord(runtime, job.unity.testRunId, job.id).resolution).toContain("结果仍未知");
  await expect(c.recover()).resolves.toBeUndefined();
});
it("write-ahead request survives restart, has unique identity and cannot be read as another execution", async () => {
  const { runtime, c, job } = setup();
  const record = new TestJournal(runtime, { executionId: job.id, stageId: "wait", project: "fixture" });
  record.update({ state: "requested" });
  expect(readTestRecord(runtime, record.id, job.id).state).toBe("requested");
  expect(() => readTestRecord(runtime, record.id, "other")).toThrow("不匹配");
  await expect(c.recover()).rejects.toThrow("持久测试请求");
});
it("contradictory native summary and individual results are never reported as passed", async () => {
  const { c, job, runtime } = setup({}, { Summary: { Status: "Passed", TotalTests: 1, PassedTests: 1, FailedTests: 0, SkippedTests: 0 }, Results: [{ Name: "fixture", Status: "Failed" }] });
  await c.prepare(job, () => false);
  await expect(c.verify(job, { id: "contradiction", check: { mode: "EditMode" } })).rejects.toThrow();
  expect(readTestRecord(runtime, job.unity.testRunId, job.id).state).toBe("unknown");
  await expect(c.release(job)).rejects.toThrow("未知");
});
it("project resource cleanup is recorded before pass; cleanup failure retains raw results and lease until reviewed", async () => {
  const result = { Summary: { Status: "Passed", TotalTests: 1, PassedTests: 1, FailedTests: 0, SkippedTests: 0 }, Results: [{ Name: "fixture", Status: "Passed" }] };
  for (const fails of [false, true]) {
    const patch: any = { resourceCleanupError: fails };
    const { c, job, runtime } = setup(patch, result);
    job.projectAuthorization = "fixture-grant";
    await c.prepare(job, () => false);
    if (fails) {
      await expect(c.verify(job, { id: "scoped", check: { mode: "EditMode" } })).rejects.toThrow("cleanup lost");
      await expect(c.release(job)).rejects.toThrow("未知");
      expect(readTestRecord(runtime, job.unity.testRunId, job.id)).toMatchObject({ state: "unknown", result });
      patch.resourceCleanupError = false;
      await c.releaseReviewed(job);
      expect(readTestRecord(runtime, job.unity.testRunId, job.id).resourceScopeEnd).toBe("scope-restored|fixture");
      await expect(c.recover()).resolves.toBeUndefined();
    } else {
      await expect(c.verify(job, { id: "scoped", check: { mode: "EditMode" } })).resolves.toMatchObject({ passed: true });
      expect(readTestRecord(runtime, job.unity.testRunId, job.id).resourceScopeEnd).toBe("scope-restored|fixture");
      await c.release(job);
    }
  }
});
