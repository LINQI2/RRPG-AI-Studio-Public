import fs from "node:fs";
import path from "node:path";
import type { Row } from "../../shared/contracts.js";
import type { Config } from "../config.js";
import { unitySettings, projectSettings } from "../project-config.js";
import { UnityMcp, McpToolError } from "./mcp.js";
import { TestJournal, TestFailure } from "./test-journal.js";
export interface ExecutionEnvironment {
  health?(): Row;
  check(task: Row): void;
  prepare(job: Row, stopped: () => boolean): Promise<void>;
  release(job: Row): Promise<void>;
  recover(): Promise<void>;
  watch?(job: Row, failed: (reason: string) => void): () => void;
  reviewIdle?(): Promise<Row>;
  releaseReviewed?(job: Row): Promise<void>;
}
// A manually opened editor is always borrowed. This module has no process
// launch/kill API and never changes an editor's configuration or permissions.
export class UnityConnection implements ExecutionEnvironment {
  readonly lock: string;
  constructor(
    private cfg: Config,
    private client = (token: string, url: string) => new UnityMcp(token, url),
  ) {
    this.lock = path.join(cfg.runtime, "unity-project.lock.json");
  }
  health() {
    try {
      const p = projectSettings(this.cfg.runtime);
      return {
        supported: true,
        status:
          p.root && p.unity.enabled ? "manual_connection" : "not_configured",
        automaticStart: false,
      };
    } catch {
      return {
        supported: true,
        status: "configuration_error",
        automaticStart: false,
      };
    }
  }
  check(task: Row) {
    if (!task.useUnity || task.owner !== "developer")
      throw Error("任务未选择工程验证");
    const cfg = unitySettings(this.cfg);
    if (!cfg.allowExecution) throw Error("工程仅允许身份核对；尚未授权执行");
    if (fs.existsSync(this.lock))
      throw Error("该工程已有执行或恢复待核对，不能并行写入/测试");
  }
  async inspect() {
    const cfg = unitySettings(this.cfg),
      m = this.client(cfg.token, cfg.endpoint);
    await m.connect();
    const list = await m.call("tools/list");
    if (!list.tools?.some((t: Row) => t.name === "script-execute"))
      throw Error("MCP 未提供工程身份核对工具");
    const code = `using UnityEngine; public class StudioIdentity { public static string Read() { return JsonUtility.ToJson(new Identity { project=System.IO.Path.GetDirectoryName(Application.dataPath), version=Application.unityVersion, compiling=UnityEditor.EditorApplication.isCompiling, compileFailed=UnityEditor.EditorUtility.scriptCompilationFailed, playing=UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode, pending=UnityEditor.SessionState.GetString("Unity_MCP_TestRunner_TestCallRequestID","") }); } [System.Serializable] public class Identity {public string project,version,pending;public bool compiling,compileFailed,playing;} }`;
    const reply = await m.tool("script-execute", {
      csharpCode: code,
      className: "StudioIdentity",
      methodName: "Read",
      isMethodBody: false,
    });
    const identity =
      typeof reply === "object" && reply?.value
        ? JSON.parse(reply.value)
        : typeof reply === "string"
          ? JSON.parse(reply)
          : reply;
    if (
      path.resolve(identity.project).toLowerCase() !==
        path.resolve(cfg.root).toLowerCase() ||
      identity.version !== cfg.version
    )
      throw Error("MCP 实际工程或编辑器版本与配置不符；没有执行测试");
    if (identity.compiling || identity.compileFailed)
      throw Error("编辑器正在编译或存在编译失败");
    return { cfg, m, identity };
  }
  async prepare(job: Row, stopped: () => boolean) {
    this.check({ ...job, useUnity: true });
    fs.writeFileSync(
      this.lock,
      JSON.stringify({ executionId: job.id, pid: process.pid }),
      { flag: "wx" },
    );
    try {
      const { identity } = await this.inspect();
      if (identity.playing || identity.pending)
        throw Error("编辑器已有运行或测试，不能接管");
      if (stopped()) throw Error("任务已停止");
      job.unity = {
        state: "ready",
        readyAt: new Date().toISOString(),
        ...identity,
      };
    } catch (e) {
      fs.unlinkSync(this.lock);
      throw e;
    }
  }
  async reviewIdle() {
    const { identity, m } = await this.inspect();
    const state = await m.tool("script-execute", {
      csharpCode: 'using UnityEngine; using UnityEditor; using System.Reflection; public class StudioTestState { public static string Read() { var method=typeof(UnityEditor.TestTools.TestRunner.Api.TestRunnerApi).GetMethod("IsRunActive",BindingFlags.Static|BindingFlags.NonPublic); if(method==null) throw new System.Exception("Native test state API absent"); return JsonUtility.ToJson(new State { running=(bool)method.Invoke(null,null), pending=SessionState.GetString("MCP_PendingTestRun",""), activeRequest=SessionState.GetString("Unity_MCP_TestRunner_TestCallRequestID","") }); } [System.Serializable] public class State { public bool running; public string pending,activeRequest; } }',
      className: "StudioTestState", methodName: "Read", isMethodBody: false,
    });
    const native = typeof state === "string" ? JSON.parse(state) : state;
    if (identity.playing || identity.pending || native?.running !== false ||
        native.pending !== "" || native.activeRequest !== "")
      throw Error("原生Test Runner仍活动或状态不明确；未解锁或重跑");
    return { identity, native, observedAt: new Date().toISOString() };
  }
  async release(job: Row) {
    if (job.unity?.testPending)
      throw Error("测试投递结果未知；保留工程锁，不允许重跑或并行测试");
    if (
      fs.existsSync(this.lock) &&
      JSON.parse(fs.readFileSync(this.lock, "utf8")).executionId === job.id
    )
      fs.unlinkSync(this.lock);
    job.unity = { ...job.unity, state: "released", editorClosed: false };
  }
  async releaseReviewed(job: Row) {
    if (fs.existsSync(this.lock) && JSON.parse(fs.readFileSync(this.lock, "utf8")).executionId !== job.id)
      throw Error("工程锁属于其他执行；不回收");
    await this.reviewIdle();
    const scopeDirectory = path.join(this.cfg.runtime, "unity-tests");
    if (fs.existsSync(scopeDirectory)) for (const name of fs.readdirSync(scopeDirectory).filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const file = path.join(scopeDirectory, name), record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record.executionId === job.id && record.resourceScopeIntent && record.resourceScope !== "not-configured" && !record.resourceScopeEnd) {
        const { m } = await this.inspect();
        const resourceScopeEnd = await this.resourceHook(m, "End");
        if (!resourceScopeEnd.startsWith("scope-restored|")) throw Error("测试资源尚未回收，不释放租约");
        const temp = file + ".tmp";
        fs.writeFileSync(temp, JSON.stringify({ ...record, resourceScopeEnd }, null, 2)); fs.renameSync(temp, file);
      }
    }
    job.unity = { ...job.unity, testPending: false };
    await this.release(job);
    const directory = path.join(this.cfg.runtime, "unity-tests");
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory).filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const file = path.join(directory, name), record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record.executionId === job.id && ["requested", "unknown"].includes(record.state) && !record.resolvedAt) {
        const replacement = file + ".tmp";
        fs.writeFileSync(replacement, JSON.stringify({ ...record, resolvedAt: new Date().toISOString(), resolution: "原生运行已空闲；测试结果仍未知，不重放" }, null, 2));
        fs.renameSync(replacement, file);
      }
    }
  }
  private async resourceHook(m: UnityMcp, action: "Begin" | "End"): Promise<string> {
    if (action === "End") {
      // A PlayMode exit reloads the plugin domain. Wait through it with bounded,
      // read-only checks before sending a cleanup mutation; never resend End.
      let idle = false;
      for (let i = 0; i < 20; i++) {
        try { await this.reviewIdle(); idle = true; break; }
        catch (error) {
          if (/实际工程|版本与配置不符/.test(String(error)) || i === 19) throw error;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      if (!idle) throw Error("测试退出尚未稳定，资源等待核对");
      m = (await this.inspect()).m; // bind to the plugin after the domain reload
    }
    const result = await m.tool("script-execute", {
      csharpCode: `using System; using System.Reflection; public class StudioTestResourceHook { public static string Run() { var t=Type.GetType("StudioTestResourceScope, Assembly-CSharp-Editor",false); if(t==null)return "not-configured"; return (string)t.GetMethod("${action}",BindingFlags.Public|BindingFlags.Static).Invoke(null,null); } }`,
      className: "StudioTestResourceHook", methodName: "Run", isMethodBody: false,
    });
    if (typeof result !== "string") throw Error("测试资源隔离回执不明确");
    return result;
  }
  async recover() {
    if (fs.existsSync(this.lock))
      throw Error(
        "上次工程执行状态未知，请核对后手动解除锁；不重放、不关闭编辑器",
      );
    const directory = path.join(this.cfg.runtime, "unity-tests");
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory).filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const record = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      if (["requested", "unknown"].includes(record.state) && !record.resolvedAt)
        throw Error("存在未核对的持久测试请求；不重放或创建新测试");
    }
  }
  watch(_job: Row, failed: (reason: string) => void) {
    let checking = false,
      misses = 0;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        await this.inspect();
        misses = 0;
      } catch (e) {
        if (++misses >= 3) {
          clearInterval(timer);
          failed(String(e));
        }
      } finally {
        checking = false;
      }
    }, 10000);
    return () => clearInterval(timer);
  }
  async verify(job: Row, stage: Row) {
    if (job.unity?.testPending) throw Error("原测试尚未核对，未创建或重发测试");
    const journal = new TestJournal(this.cfg.runtime, { executionId: job.id, stageId: stage.id,
      project: unitySettings(this.cfg).root, filter: stage.check, timeoutMs: 660000 });
    job.unity = { ...job.unity, testRunId: journal.id };
    try {
    const { m, identity } = await this.inspect();
    if (
      !fs.existsSync(this.lock) ||
      JSON.parse(fs.readFileSync(this.lock, "utf8")).executionId !== job.id
    )
      throw Error("当前任务不持有工程锁");
    if (identity.playing || identity.pending) {
      journal.update({reasonCode:"editor_busy"});
      throw Error("编辑器已有运行或测试，未重复发送");
    }
    await this.reviewIdle();
    const sceneText = await m.tool("script-execute", {
      csharpCode: 'using UnityEngine.SceneManagement; public class StudioSceneState { public static string Read() { var parts=new System.Collections.Generic.List<string>(); for(int i=0;i<SceneManager.sceneCount;i++){var s=SceneManager.GetSceneAt(i);parts.Add(System.Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s.path))+","+(s.isDirty?"1":"0"));} return "studio-scenes-v1|"+SceneManager.sceneCount+"|"+string.Join("|",parts); } }',
      className: "StudioSceneState", methodName: "Read", isMethodBody: false,
    });
    if (typeof sceneText !== "string" || !sceneText.startsWith("studio-scenes-v1|")) throw Error("未取得可信场景状态，未发送测试");
    const [, countText, ...sceneRows] = sceneText.split("|");
    const sceneCount = Number(countText), rows = sceneCount === 0 && sceneRows.join("") === "" ? [] : sceneRows;
    if (!Number.isSafeInteger(sceneCount) || sceneCount < 0 || rows.length !== sceneCount || rows.some(r => !/^[A-Za-z0-9+/=]*,[01]$/.test(r)))
      throw Error("场景状态格式不明确，未发送测试");
    const dirty = rows.filter(r => r.endsWith(",1")).map(r => Buffer.from(r.split(",")[0], "base64").toString("utf8"));
    journal.update({ identity, dirtyScenes: dirty });
    if (dirty.length) throw Error(`场景存在未保存修改，测试未启动：${dirty.join("；")}。未保存或丢弃场景。`);
    if (job.projectAuthorization) {
      journal.update({ resourceScopeIntent: true });
      const resourceScope = await this.resourceHook(m, "Begin");
      if (resourceScope !== "not-configured" && !resourceScope.startsWith("scope-active|")) throw Error("项目测试资源未准备好");
      journal.update({ resourceScope });
    }
    journal.update({ state: "requested", requestedAt: new Date().toISOString() });
    job.unity = { ...job.unity, testPending: true };
    const result = await m.tool("tests-run", {
      ...stage.check.filter,
      testMode: stage.check.mode,
      includePassingTests: true,
    }, rawResponse => journal.update({ rawResponse }));
    journal.update({ result, responseAt: new Date().toISOString() });
    if (journal.record.resourceScope?.startsWith("scope-active|")) {
      const resourceScopeEnd = await this.resourceHook(m, "End");
      if (!resourceScopeEnd.startsWith("scope-restored|")) throw Error("测试资源回收未完成，不能判为通过");
      journal.update({ resourceScopeEnd });
    }
    const s = result?.Summary;
    const countsMatch = s && [s.TotalTests, s.PassedTests, s.FailedTests, s.SkippedTests].every(n => Number.isSafeInteger(n) && n >= 0) &&
      s.TotalTests > 0 && Array.isArray(result.Results) && result.Results.length === s.TotalTests &&
      s.PassedTests + s.FailedTests + s.SkippedTests === s.TotalTests &&
      result.Results.filter((r: Row) => r.Status === "Passed").length === s.PassedTests &&
      result.Results.filter((r: Row) => r.Status === "Failed").length === s.FailedTests &&
      result.Results.filter((r: Row) => r.Status === "Skipped").length === s.SkippedTests;
    if (countsMatch && ["Passed", "Failed"].includes(s.Status) &&
        (s.Status !== "Passed" || s.PassedTests === s.TotalTests)) {
      journal.update({ state: s.Status === "Passed" ? "passed" : "failed", finishedAt: new Date().toISOString() });
      job.unity.testPending = false;
    }
    if (
      !s ||
      s.Status !== "Passed" ||
      !Number.isSafeInteger(s.TotalTests) ||
      s.TotalTests <= 0 ||
      s.PassedTests !== s.TotalTests ||
      s.FailedTests ||
      s.SkippedTests ||
      result.Results?.length !== s.TotalTests
      || result.Results?.some((r: Row) => r.Status !== "Passed") || !countsMatch
    )
      throw Error(`Unity验证未通过或回执不完整；完整原始结果已保存在测试记录 ${journal.id}`);
    const evidence = { identity, result, observedAt: new Date().toISOString() };
    fs.writeFileSync(
      path.join(job.workspace, `UNITY-${stage.id}.json`),
      JSON.stringify(evidence, null, 2),
    );
    return { passed: true, mode: "real-unity-tests", testRunId: journal.id, ...evidence };
    } catch (error) {
      const definiteRejection = error instanceof McpToolError &&
        /Cannot run tests:.*unsaved changes|No tests found|Original request with valid RequestID/.test(error.message);
      let state = journal.record.state === "preflight" || definiteRejection ? "rejected" :
        ["passed", "failed"].includes(journal.record.state) ? journal.record.state : "unknown";
      if (state === "rejected" && journal.record.resourceScopeIntent && journal.record.resourceScope !== "not-configured" && !journal.record.resourceScopeEnd) {
        try {
          await this.reviewIdle();
          const { m } = await this.inspect();
          const resourceScopeEnd = await this.resourceHook(m, "End");
          if (!resourceScopeEnd.startsWith("scope-restored|")) throw Error("测试资源未回收");
          journal.update({ resourceScopeEnd });
        } catch (cleanupError) {
          journal.update({ resourceCleanupError: String(cleanupError) });
          state = "unknown";
          job.unity.testPending = true;
        }
      }
      journal.update({ state, error: String(error) });
      if (state === "rejected") job.unity.testPending = false;
      throw new TestFailure(String(error), journal.id, state);
    }
  }
}
