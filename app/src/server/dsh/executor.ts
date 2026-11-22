import { DSH_MODEL_BUDGET_MS } from "./limits.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store, hash } from "../db.js";
import { safePath, appRoot, type Config } from "../config.js";
import { now, StudioError, type Row } from "../../shared/contracts.js";
import type { DshConnection } from "./sdk.js";
import { managedRoot, type WorkspaceLifecycle } from "./workspace.js";
import { executionOptions, type ExecutionStage } from "./policy.js";
import { verifyArtifact, type StageVerifier } from "./stages.js";
import type { ExecutionEnvironment } from "../unity/connection.js";
import { executionWorkspace, projectTaskGrant, type ProjectWorkspaceGrant } from "./project-workspace.js";
import { inspectProject } from "../project-inspect.js";
import { createHash } from "node:crypto";
import { readSessionJournal } from "./session-journal.js";
import { TestFailure, readTestRecord } from "../unity/test-journal.js";
import { maintenance } from "../runtime-status.js";

export const dshRequestPrefix = "studio:dsh:v1:";
export interface DshPolicy {
  allowed: boolean;
  source: "real" | "simulated";
  reason: string;
  provider?: string;
  model?: string;
  maxOutputTokens?: number;
  maxRuntimeMs: number;
  managedShell?: boolean;
  projectWorkspace?: ProjectWorkspaceGrant;
}
export type DshFactory = (
  job: Row,
  onEvent: (method: string, params: Row) => void,
) => Promise<DshConnection>;
export const pendingDshPolicy: DshPolicy = {
  allowed: false,
  source: "real",
  reason:
    "DSH 尚未启用经核验的本机 SDK 配置；未启动模型。Windows 原生 ACL 仅为部分隔离，不能等同于网络或读取隔离。",
  maxRuntimeMs: DSH_MODEL_BUDGET_MS,
};
const activeStates = ["preparing", "dispatching", "running", "verifying", "cancelling"];
const reviewed = (job: Row) => job.status === "unknown" &&
  (job.supersededBy || job.recoveryReview?.safeToContinue === true);
export class DshExecutor {
  active = new Map<string, Promise<void>>();
  connections = new Map<string, DshConnection>();
  stopping = false;
  recovering = new Set<string>();
  recoveryTasks = new Set<Promise<Row>>();
  ready: Promise<void>;
  startupRecovery = true;
  permissionFailures: string[] = [];
  environmentRecoveryError: string | null = null;
  onSettled?: (job: Row) => void | Promise<void>;
  constructor(
    public store: Store,
    public cfg: Config,
    public policy = pendingDshPolicy,
    private factory?: DshFactory,
    private lifecycle?: WorkspaceLifecycle,
    private verifyStage: StageVerifier = verifyArtifact,
    private environment?: ExecutionEnvironment,
  ) {
    // A restart is not evidence of failure or permission to repeat a prompt.
    for (const job of store.all("executions"))
      if (activeStates.includes(job.status))
        store.update("executions", job.id, {
          status: "unknown",
          error: "后台重启；原投递结果须核对，不自动重发。",
          resultNotice: "pending",
        });
    this.ready = (async () => {
      try {
        for (const r of (await this.lifecycle?.recover()) ?? []) {
          const job = store
            .all("executions")
            .find((j) => j.sessionId === r.sessionId);
          if (r.error) this.permissionFailures.push(r.sessionId);
          if (job)
            store.update("executions", job.id, {
              permissionState: r.error ? "recovery_required" : "released",
              permissionError: r.error || null,
              resultNotice: "pending",
            });
        }
      } catch {
        this.permissionFailures.push("startup-recovery-failed");
      } finally {
        try {
          await this.environment?.recover();
        } catch (e) {
          this.environmentRecoveryError = String(e);
        }
        this.startupRecovery = false;
      }
    })();
  }
  health() {
    return {
      maintenance: maintenance(this.cfg),
      ...this.policy,
      maxConcurrent: 2,
      active: this.active.size,
      nativeInterface: "DSH SDK JSON-RPC / Session",
      billingHardCap: false,
      outputBudget: { studioDefaultLimit: this.policy.maxOutputTokens ?? null, nativeModelLimitsApply: true },
      managedShell: !!this.policy.managedShell,
      unity: {
        supported: !!this.environment,
        recoveryError: this.environmentRecoveryError,
        ...this.environment?.health?.(),
      },
      permissionRecoveryPending:
        this.startupRecovery || this.permissionFailures.length > 0,
    };
  }
  request(taskId: string, input: Row, actor = "producer") {
    if (maintenance(this.cfg)) throw new StudioError("工作台正在维护，未派发任务；现有历史保留", 409);
    if (this.stopping) throw new StudioError("后台正在关闭，未提交执行", 409);
    const storedTask = this.store.get("tasks", taskId);
    const grantRoot = storedTask && projectTaskGrant(storedTask, this.store.all('tasks'), this.policy.projectWorkspace);
    const task: Row | undefined = storedTask && { ...storedTask, useUnity: storedTask.useUnity || (!!grantRoot && this.policy.projectWorkspace?.useUnity === true) };
    if (!task || task.executor !== "dsh")
      throw new StudioError(
        "请使用新建的 DSH 执行任务；不会改绑旧 Codex 任务。",
        409,
      );
    if (
      task.purpose !== "product" ||
      ["completed", "cancelled", "awaiting_acceptance"].includes(task.status)
    )
      throw new StudioError("仅未结束的已授权研发任务可提交执行", 409);
    if (actor !== "producer" && task.owner !== actor)
      throw new StudioError("仅任务负责人可提交执行", 403);
    const prompt = String(input.instruction || "").trim(),
      key = String(input.clientRequestId || "");
    if (!prompt || prompt.length > 20000 || key.length < 8 || key.length > 160)
      throw new StudioError("需要明确执行目标和有效提交标识");
    if (input.shellMode !== undefined && input.shellMode !== "managed")
      throw new StudioError("无效执行目录授权方式");
    const shellMode = input.shellMode === "managed" ? "managed" : "disabled";
    const project = grantRoot
      ? this.policy.projectWorkspace : undefined;
    if (project && (shellMode !== "disabled" || task.owner !== "developer"))
      throw new StudioError("本任务仅授权主开发工程文件工具；Pilot Shell/ACL尚未授权", 409);
    const options = executionOptions(input);
    if (options.workspace === 'project' && !project) throw new StudioError('等待工程接入：本任务尚未获得配置工程的执行绑定；未启动模型。请维护端核对已有授权，勿改用临时目录重试。',409);
    if (options.workspace === 'isolated' && project) throw new StudioError('任务已绑定工程；独立目录工作请使用独立任务，未派发。',409);
    if (options.stages?.some(s=>s.check?.kind==='unity-tests') && !task.useUnity) throw new StudioError('等待Unity接入：任务尚未启用工程验证；未启动模型。',409);
    const id = `dsh:${hash({ actor, key })}`,
      fingerprint = hash({
        actor,
        taskId,
        prompt,
        ...(shellMode === "managed" ? { shellMode } : {}),
        ...options,
      });
    const prior = this.store.get("executions", id);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new StudioError("提交标识与原 DSH 任务冲突", 409);
      return prior;
    }
    if (task.useUnity) {
      if (
        !this.environment ||
        this.startupRecovery ||
        this.environmentRecoveryError
      )
        throw new StudioError("Unity连接未配置或原环境待核对；未派发模型", 409);
      if (
        this.store
          .all("executions")
          .some(
            (j) =>
              j.useUnity &&
              (activeStates.includes(j.status) ||
                [
                  "preparing",
                  "starting",
                  "connecting",
                  "ready",
                  "releasing",
                  "cleanup_required",
                  "disconnected",
                ].includes(j.unity?.state)),
          )
      )
        throw new StudioError(
          "同一Unity工程正在执行或清理，禁止并行写入和测试",
          409,
        );
      this.environment.check(task);
    }
    if (
      shellMode === "managed" &&
      (!this.policy.managedShell ||
        !this.lifecycle ||
        this.startupRecovery ||
        this.permissionFailures.length)
    )
      throw new StudioError(
        "独立目录 Shell 尚未授权或权限恢复未完成；未启动执行",
        409,
      );
    if (
      this.store
        .all("executions")
        .some(
          (j) =>
            j.taskId === taskId &&
            [...activeStates, "unknown", "blocked"].includes(j.status) && !reviewed(j),
        )
    )
      throw new StudioError(
        "原执行尚未解决；请核对原记录，不重复创建执行。",
        409,
      );
    if (this.policy.allowed && this.active.size + this.recovering.size >= 2)
      throw new StudioError(
        "两个独立执行正在进行，请等待容量释放；未创建第三个执行。",
        409,
      );
    if (project && this.store.all("executions").some(j =>
      j.projectAuthorization &&
      path.resolve(j.workspace).toLowerCase() === project.root.toLowerCase() &&
      [...activeStates, "unknown", "blocked"].includes(j.status) && !reviewed(j)))
      throw new StudioError("该工程已有执行或未知投递；禁止并行修改", 409);
    const continuations = this.store.all("executions").filter(j => j.taskId === taskId &&
      reviewed(j) && !j.supersededBy);
    for (const prior of continuations) {
      if (this.recovering.size || !project ||
          this.projectFingerprint(inspectProject(project.root)) !== prior.recoveryReview.snapshotHash)
        throw new StudioError("恢复核对后工程已变化或正在核对；请重新核对，不盲目续接", 409);
    }
    const sessionId = `rrpg-dsh-${randomUUID()}`;
    const workspace = project?.root || safePath(
      appRoot,
      path.join(
        shellMode === "managed"
          ? managedRoot()
          : path.join(appRoot, "workspaces/executions-files"),
        sessionId,
        ...(shellMode === "managed" ? ["work"] : []),
      ),
    );
    const home = safePath(
      appRoot,
      path.join(this.cfg.runtime, "dsh-sessions", sessionId),
    );
    const job = this.store.create("executions", {
      id,
      fingerprint,
      taskId,
      owner: task.owner,
      actor,
      sessionId,
      instruction: prompt,
      ...(task.useUnity ? { useUnity: task.useUnity } : {}),
      shellMode,
      permissionState: shellMode === "managed" ? "pending" : "not_requested",
      workspace,
      ...(project ? { projectAuthorization: project.authorization, projectGrantRootTaskId: grantRoot } : {}),
      ...(shellMode === "managed"
        ? { directoryRoot: path.dirname(workspace) }
        : {}),
      home,
      provider: "dsh",
      executionSource: this.policy.source,
      status: this.policy.allowed ? "preparing" : "blocked",
      reason: this.policy.reason,
      model: this.policy.model || null,
      outputCap: options.maxTokens === null ? null : options.maxTokens ?? this.policy.maxOutputTokens ?? null,
      ...(options.reasoningEffort
        ? { reasoningEffort: options.reasoningEffort }
        : {}),
      ...(options.stages
        ? { stages: options.stages.map((s) => ({ ...s, state: "pending" })) }
        : {}),
      billingHardCap: false,
      modelOutcome: null,
      validation: "not_verified",
      summary: "",
      error: null,
    });
    for (const prior of continuations) this.store.update("executions", prior.id, { supersededBy: id });
    if (this.policy.allowed && this.factory) {
      const run = this.run(job).finally(() => this.active.delete(id));
      this.active.set(id, run);
    } else if (this.policy.allowed)
      this.store.update("executions", id, {
        status: "blocked",
        reason: "尚无已核验的官方 SDK 启动配置；未启动模型。",
      });
    return this.store.get("executions", id)!;
  }
  private observe(job: Row, method: string, params: Row) {
    if (params.sessionId !== job.sessionId) return; // descendant identities must not finish the parent
    const event = params.event;
    if (
      method === "session.event" &&
      event &&
      Number.isSafeInteger(event.seq)
    ) {
      const id = `${job.id}:${event.seq}`;
      const previous = this.store.get("execution_events", id);
      if (previous) {
        if (hash(previous.event) !== hash(event))
          this.store.update("executions", job.id, {
            status: "unknown",
            error: "同一原生事件序号出现冲突；停止推断结果。",
          });
        return;
      }
      this.store.create("execution_events", {
        id,
        executionId: job.id,
        sessionId: job.sessionId,
        event,
      });
    }
  }
  private async run(job: Row) {
    let connection: DshConnection | undefined,
      sent = false,
      inFlight = false;
    let modelBudgetRemaining = this.policy.maxRuntimeMs;
    let deadline = Date.now() + modelBudgetRemaining;
    let currentStage = -1;
    const phases: Row[] = job.stages || [
      { id: "direct", title: "直接执行", instruction: "", state: "pending" },
    ];
    const savePhases = () =>
      this.store.update("executions", job.id, { stages: phases });
    let stopEnvironmentWatch: (() => void) | undefined;
    try {
      this.resultRoot(job);
      if (!job.projectAuthorization) {
        const directory = job.directoryRoot || job.workspace;
        fs.mkdirSync(path.dirname(directory), { recursive: true });
        fs.mkdirSync(directory);
      }
      fs.mkdirSync(job.home, { recursive: true });
      if (job.useUnity) {
        await this.environment!.prepare(
          job,
          () =>
            this.stopping ||
            !!this.store.get("executions", job.id)?.stopRequested,
        );
        if (job.unity) this.store.update("executions", job.id, { unity: job.unity });
        stopEnvironmentWatch = this.environment!.watch?.(job, (reason) => {
          this.store.update("executions", job.id, { environmentError: reason });
          if (this.active.has(job.id)) this.cancel(job.id, "interrupt");
        });
      }
      if (job.shellMode === "managed") {
        this.store.update("executions", job.id, {
          permissionState: "preparing",
        });
        await this.lifecycle!.prepare(job);
        this.store.update("executions", job.id, { permissionState: "ready" });
      }
      if (this.stopping || this.store.get("executions", job.id)?.stopRequested)
        throw Error("Execution stopped before SDK start");
      connection = await this.factory!(job, (m, p) => this.observe(job, m, p));
      this.connections.set(job.id, connection);
      const initializeParams = {
        cwd: job.workspace,
        provider: this.policy.provider || "deepseek-account",
        model: this.policy.model || "deepseek-flash",
        ...(job.outputCap == null ? {} : { maxTokens: job.outputCap }),
        ...(job.reasoningEffort
          ? { reasoningEffort: job.reasoningEffort }
          : {}),
      };
      this.store.update("executions", job.id, {
        initializeParams,
        deadlineAt: new Date(deadline).toISOString(),
      });
      const init = await connection.request("initialize", initializeParams);
      if (init.serverInfo?.name !== "deepseek-harness-sdk-runtime")
        throw Error("DSH SDK 返回非预期服务器身份");
      if (job.testOwnerReceipt) {
        const receipt = JSON.parse(fs.readFileSync(safePath(job.home, job.testOwnerReceipt), "utf8"));
        if (receipt.version !== 1 || receipt.blocked !== "mcp__studio-unity__tests-run") throw Error("原生工具守卫未激活，未发送模型任务");
        if (job.projectAuthorization && receipt.globalMutationSaveBlocked !== true)
          throw Error("受保护工程的全局保存守卫未激活，未发送模型任务");
        this.store.update("executions", job.id, { testOwnership: "studio-host", testOwnerReceipt: job.testOwnerReceipt });
      }
      if (this.stopping || this.store.get("executions", job.id)?.stopRequested)
        throw Error("Execution stopped before prompt");
      job.startedAt = now();
      this.store.update("executions", job.id, {
        nativeInitialize: "confirmed",
        status: "dispatching",
        startedAt: job.startedAt,
      });
      for (let index = 0; index < phases.length; index++) {
        currentStage = index;
        const phase = phases[index];
        if (
          this.stopping ||
          this.store.get("executions", job.id)?.stopRequested
        )
          throw Error("Execution stopped");
        if (modelBudgetRemaining <= 0)
          throw Error("整体执行时间已耗尽；未发送下一阶段");
        deadline = Date.now() + modelBudgetRemaining;
        this.store.update("executions", job.id, { deadlineAt: new Date(deadline).toISOString(), modelBudgetRemainingMs: modelBudgetRemaining });
        const previousSeq = Math.max(
          -1,
          ...this.store
            .all("execution_events")
            .filter((e) => e.executionId === job.id)
            .map((e) => e.event.seq),
        );
        Object.assign(phase, {
          state: "dispatching",
          intentAt: now(),
          fromSeq: previousSeq + 1,
          idempotencyKey: `${job.id}:${phase.id}`,
        });
        savePhases();
        sent = true; // persist intent before crossing the side-effect boundary
        inFlight = true;
        const accepted = await connection.request("session/prompt", {
          sessionId: job.sessionId,
          contentBlocks: [
            {
              type: "text",
              text: `仅本任务独立授权 目录：${job.workspace}。保持简体中文，不访问未授权工程、认证目录或其他工作区，不安装组件、不改变权限、不创建额外付费子 Agent。请自主完成当前阶段文件编写、测试和必要修复；留存实际文件及执行证据，不能仅口头声称完成。\n${job.instruction}\n${job.stages ? `当前阶段 ${index + 1}/${phases.length}：${phase.title}。只完成本阶段，后续由Studio自动继续，不越过阶段验证门禁。\n${phase.instruction}` : ""}`,
            },
          ],
        });
        Object.assign(phase, {
          state: "running",
          nativeMessageId: accepted.messageId,
          startedAt: now(),
        });
        savePhases();
        this.store.update("executions", job.id, {
          status: "running",
          nativeMessageId: accepted.messageId,
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const modelWaitStarted = Date.now();
        try {
          await Promise.race([
            connection.request("session/wait", { sessionId: job.sessionId }),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Error("DSH 等待到期，执行结果未知；不自动重试")),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          modelBudgetRemaining = Math.max(0, modelBudgetRemaining - (Date.now() - modelWaitStarted));
        }
        inFlight = false;
        const settled = this.reconcile(job.id, true);
        const endEvent = this.store
          .all("execution_events")
          .filter(
            (e) => e.executionId === job.id && e.event.type === "turn/end",
          )
          .sort((a, b) => a.event.seq - b.event.seq)
          .at(-1);
        Object.assign(phase, {
          endedAt: now(),
          outcome: settled.modelOutcome,
          endSeq: endEvent?.event.seq,
        });
        if (!endEvent || endEvent.event.seq < phase.fromSeq) {
          phase.state = "unknown";
          savePhases();
          this.store.update("executions", job.id, {
            status: "unknown",
            error: "缺少本阶段原生终态；保留检查点，禁止盲重发",
          });
          return;
        }
        if (
          settled.status !== "finished_unverified" ||
          !endEvent ||
          endEvent.event.seq < phase.fromSeq
        ) {
          phase.state = settled.status === "unknown" ? "unknown" : "failed";
          savePhases();
          return;
        }
        if (
          this.stopping ||
          this.store.get("executions", job.id)?.stopRequested
        )
          throw Error("Execution stopped before verification");
        try {
          this.store.update("executions", job.id, { status: "verifying" });
          const checkpoint = await this.verifyStage(
            job,
            phase as ExecutionStage,
          );
          phase.checkpoint = checkpoint;
          if (checkpoint.passed !== true)
            throw Error(String(checkpoint.reason || "阶段证据未通过"));
        } catch (error) {
          Object.assign(phase, { state: "failed", error: String(error),
            ...(error instanceof TestFailure ? { testRunId: error.testRunId, testState: error.testState } : {}) });
          savePhases();
          this.store.update("executions", job.id, {
            status: "failed",
            stageGateFailed: true,
            error: `阶段验证未通过：${String(error)}`,
            ...(job.unity ? { unity: job.unity } : {}),
          });
          return;
        }
        phase.state = "completed";
        savePhases();
        this.store.update("executions", job.id, { status: "finished_unverified" });
        if (index + 1 < phases.length)
          this.store.update("executions", job.id, { status: "running" });
      }
    } catch (e) {
      if (job.useUnity) {
        const old = this.store.get("executions", job.id)?.unity || {};
        this.store.update("executions", job.id, {
          unity: { ...old, error: String(e) },
        });
      }
      if (currentStage >= 0) {
        Object.assign(phases[currentStage], {
          state: inFlight ? "unknown" : "failed",
          error: String(e),
        });
        savePhases();
      }
      try {
        fs.writeFileSync(path.join(job.home, "private-error.txt"), String(e));
      } catch {
        /* journal outcome must survive inaccessible diagnostic directory */
      }
      this.store.update("executions", job.id, {
        status: inFlight ? "unknown" : "failed",
        error: inFlight
          ? "DSH 投递或执行结果未确认，请核对原 Session；未自动重发。"
          : sent
            ? "执行边界或后续阶段受阻；已有检查点保留，未盲目重试。"
            : job.useUnity &&
                !this.store.get("executions", job.id)?.unity?.readyAt
              ? "团结环境前置检查失败；未启动DSH模型。"
              : "DSH 初始化失败，未发送任务。",
        diagnosticKind: e instanceof Error ? e.name : "UnknownError",
      });
    } finally {
      stopEnvironmentWatch?.();
      let safeToRelease = true;
      try {
        await connection?.close();
      } catch {
        safeToRelease = false;
      }
      this.store.update("executions", job.id, { sdkExitConfirmed: safeToRelease });
      if (job.shellMode === "managed") {
        try {
          if (!safeToRelease) throw Error("SDK process exit not confirmed");
          await this.lifecycle!.cleanup(job);
          this.store.update("executions", job.id, {
            permissionState: "released",
            permissionError: null,
          });
        } catch (e) {
          this.permissionFailures.push(job.sessionId);
          this.store.update("executions", job.id, {
            permissionState: "recovery_required",
            permissionError: String(e),
            status: "unknown",
            error:
              "执行目录权限尚未确认回收；已停止新的 Shell 任务，请维护者核对。",
          });
        }
      }
      if (job.useUnity) {
        try {
          if (!safeToRelease)
            throw Error("原DSH进程退出未确认，不释放Unity租约");
          await this.environment!.release(job);
          if (job.unity) this.store.update("executions", job.id, { unity: job.unity });
        } catch (e) {
          const old = this.store.get("executions", job.id)?.unity || {};
          this.store.update("executions", job.id, {
            unity: { ...old, ...job.unity, state: "cleanup_required", error: String(e) },
            status: "unknown",
            cleanupError: String(e),
            error: this.store.get("executions", job.id)?.error || "Unity环境清理待核对；没有终止用户编辑器或解锁工程",
          });
        }
      }
      const current = this.store.get("executions", job.id)!;
      if (
        current.stopRequested &&
        safeToRelease &&
        current.unity?.state !== "cleanup_required" &&
        current.permissionState !== "recovery_required"
      )
        this.store.update("executions", job.id, {
          status:
            current.stopRequested === "cancel" ? "cancelled" : "interrupted",
          error: null,
          validation: "not_verified",
        });
      this.connections.delete(job.id);
      this.store.update("executions", job.id, { resultNotice: "pending" });
      if (!this.stopping && this.onSettled) {
        try {
          await this.onSettled(this.store.get("executions", job.id)!);
          this.store.update("executions", job.id, { resultNotice: "recorded" });
        } catch {
          this.store.update("executions", job.id, {
            resultNotice: "pending",
            resultNoticeError:
              "负责人通知未登记；结果与证据仍保留，可核对后恢复通知。",
          });
        }
      }
    }
  }
  cancel(id: string, kind: "cancel" | "interrupt" = "cancel") {
    const job = this.store.get("executions", id);
    if (!job) throw new StudioError("执行记录不存在", 404);
    if (!this.active.has(id))
      throw new StudioError(
        "执行已结束或结果未知；请核对原记录，不重复中断",
        409,
      );
    if (job.stopRequested) return job;
    this.store.update("executions", id, {
      stopRequested: kind,
      status: "cancelling",
    });
    void this.connections
      .get(id)
      ?.close()
      .catch(() => {});
    return this.store.get("executions", id)!;
  }
  reconcile(id: string, internal = false) {
    const job = this.store.get("executions", id);
    if (!job) throw new StudioError("执行记录不存在", 404);
    if (job.status === "blocked") return job;
    if (
      job.stageGateFailed ||
      (!internal && job.stages?.some((s: Row) => s.state !== "completed"))
    )
      return job;
    if (!internal && this.active.has(id))
      throw new StudioError(
        "执行仍在当前后台运行；不根据部分事件提前核定结果",
        409,
      );
    const events = this.store
      .all("execution_events")
      .filter((e) => e.executionId === id)
      .map((e) => e.event)
      .sort((a, b) => a.seq - b.seq);
    const last = events.filter((e) => e.type === "turn/end").at(-1);
    const later = events.some(
      (e) => e.seq > (last?.seq ?? -1) && e.type === "turn/start",
    );
    const answer = events.filter((e) => e.type === "assistant/message").at(-1)
      ?.data?.message?.content;
    const summary = Array.isArray(answer)
      ? answer
          .filter((b: Row) => b.type === "text")
          .map((b: Row) => b.text)
          .join("\n")
      : "";
    const outcome = last?.data?.reason?.kind;
    // A native completion is execution-layer settlement, never professional or producer acceptance.
    return this.store.update("executions", id, {
      status:
        !last ||
        later ||
        job.error?.includes("冲突") ||
        job.permissionState === "recovery_required"
          ? "unknown"
          : outcome === "completed"
            ? "finished_unverified"
            : "failed",
      modelOutcome: outcome || null,
      toolErrorCount: events.filter(
        (e) => e.type === "tool/result" && e.data?.message?.isError === true,
      ).length,
      summary,
      validation: "not_verified",
      settledAt: now(),
      error:
        job.permissionState === "recovery_required"
          ? "执行目录权限尚未确认回收；原生结束不代表安全回收完成。"
          : !last || later
            ? "缺少完整终态证据，请核对原 Session；禁止盲重发。"
            : job.error?.includes("冲突")
              ? job.error
              : null,
    });
  }
  async drain() {
    await Promise.allSettled([...this.active.values()]);
  }
  resultRoot(job: Row) {
    return executionWorkspace(job, this.policy.projectWorkspace);
  }
  testRecord(id: string, testRunId: string) {
    if (!this.store.get("executions", id)) throw new StudioError("执行不存在", 404);
    return readTestRecord(this.cfg.runtime, testRunId, id);
  }
  async verifyRecovery(id: string, clientRequestId: string) {
    const job = this.store.get("executions", id);
    if (!job) throw new StudioError("执行不存在", 404);
    const prior = (job.recoveryVerifications || []).find((r: Row) => r.clientRequestId === clientRequestId);
    if (prior) return prior; // never replay a request whose response was lost
    if ((job.recoveryVerifications || []).some((r: Row) => ["preparing", "requested", "unknown"].includes(r.state)))
      throw new StudioError("已有恢复验证结果未核对，未创建第二次请求", 409);
    if (!maintenance(this.cfg) || this.active.size || this.recovering.size || !job.recoveryReview?.safeToContinue ||
        !job.useUnity || !job.projectAuthorization || job.sdkExitConfirmed !== true)
      throw new StudioError("恢复验证前置未通过；只允许维护中补测已核对的执行", 409);
    this.resultRoot(job);
    const stage = job.stages?.findLast((s: Row) => s.check?.kind === "unity-tests");
    if (!stage) throw new StudioError("原执行没有明确的Unity验证计划", 409);
    this.recovering.add(id);
    const entry: Row = { clientRequestId, state: "preparing", requestedAt: now() };
    const save = () => this.store.update("executions", id, { recoveryVerifications: [...(job.recoveryVerifications || []), entry] });
    save();
    try {
      await this.environment!.prepare(job, () => this.stopping);
      const checkpoint = await this.verifyStage(job, stage);
      Object.assign(entry, { state: "passed", testRunId: checkpoint.testRunId, checkpoint });
    } catch (error) {
      Object.assign(entry, { state: error instanceof TestFailure ? (error.testState === "passed" ? "verification_error" : error.testState) : "not_started",
        error: String(error), ...(error instanceof TestFailure ? { testRunId: error.testRunId } : {}) });
    } finally {
      try { await this.environment!.release(job); }
      catch (error) { entry.cleanupError = String(error); entry.state = "unknown"; }
      Object.assign(entry, { endedAt: now() });
      save();
      this.store.update("executions", id, { unity: job.unity });
      this.recovering.delete(id);
    }
    return entry;
  }
  private projectFingerprint(snapshot: Row) {
    return hash({ root: snapshot.root, branch: snapshot.branch, head: snapshot.head, files: snapshot.files });
  }
  async reviewUnknown(id: string) {
    const job = this.store.get("executions", id);
    const othersRunning = () => [...this.active.keys()].some(key => key !== id || this.connections.has(key));
    if (!job || job.status !== "unknown" || !job.projectAuthorization || !job.useUnity ||
        job.shellMode !== "disabled" || job.permissionState !== "not_requested" ||
        this.stopping || this.startupRecovery || othersRunning() || this.recovering.size ||
        !this.environment?.reviewIdle || job.supersededBy)
      throw new StudioError("当前不符合只读安全恢复核对条件，未重跑或改状态", 409);
    this.resultRoot(job);
    const baselinePath = this.policy.projectWorkspace?.recoveryBaseline;
    if (!baselinePath) throw new StudioError("缺少维护端保护文件基线，不能解除续接阻塞", 409);
    const baseline = JSON.parse(fs.readFileSync(safePath(this.cfg.runtime,
      path.resolve(this.cfg.runtime, baselinePath)), "utf8"));
    if (path.resolve(baseline.root).toLowerCase() !== path.resolve(job.workspace).toLowerCase() ||
        !baseline.protectedFiles?.length) throw Error("恢复基线工程或保护文件范围无效");
    const journal = safePath(appRoot, path.join(job.home, "private-stderr.log"));
    if (job.sdkExitConfirmed !== true &&
        !(fs.existsSync(journal) && /DSH exit code=\d+ signal=null\s*$/.test(fs.readFileSync(journal, "utf8"))))
      throw new StudioError("原SDK进程退出尚无可信证据；不能续接", 409);
    this.recovering.add(id);
    this.store.update("executions", id, { recoveryReview: null });
    try {
      const native = readSessionJournal(job);
      for (const event of native) {
        const previous = this.store.get("execution_events", `${id}:${event.seq}`);
        if (previous && hash(previous.event) !== hash(event)) throw Error("原生记录与已有事件冲突，未恢复");
      }
      const nativeEnd = native.filter(e => e.type === "turn/end").at(-1);
      if (!nativeEnd || native.some(e => e.seq > nativeEnd.seq && e.type === "turn/start"))
        throw Error("原生记录仍无完整终态，未解除阻塞");
      const state = await this.environment.reviewIdle();
      for (const file of baseline.protectedFiles) {
        const target = safePath(job.workspace, path.resolve(job.workspace, file.path));
        const current = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
        if (current !== file.sha256) throw Error("保护文件与维护端原基线不符；未续接");
      }
      const snapshot = inspectProject(job.workspace);
      if (!snapshot.complete || othersRunning()) throw Error("当前基线或执行状态不完整");
      const confirmation = await this.environment.reviewIdle();
      await this.environment.releaseReviewed?.(job);
      await this.environment.recover();
      this.environmentRecoveryError = null;
      const review = { safeToContinue: true, sdkExitConfirmed: true, state, confirmation, snapshot,
        snapshotHash: this.projectFingerprint(snapshot), protectedCount: baseline.protectedFiles.length,
        at: now(), note: "保留原状态及错误，不推断测试通过；仅允许基于当前差异补缺失验证，不重放原指令" };
      const recoveredSeq: number[] = [];
      for (const event of native) if (!this.store.get("execution_events", `${id}:${event.seq}`)) {
        this.observe(job, "session.event", { sessionId: job.sessionId, event });
        recoveredSeq.push(event.seq);
      }
      const outcome = nativeEnd.data?.reason?.kind;
      this.store.update("executions", id, { recoveryReview: review,
        ...(job.unity ? { unity: job.unity } : {}),
        nativeRecovery: { at: now(), recoveredSeq, originalStatus: job.status, originalError: job.error, end: nativeEnd },
        ...(outcome && outcome !== "completed" ? { status: "failed", modelOutcome: outcome,
          error: "原生记录确认执行中止；缺少有效Unity测试结果，不代表测试断言失败" } : {}),
        ...(outcome === "completed" && job.stageGateFailed ? { status: "failed", error: job.stages?.find((s: Row) => s.error)?.error || job.error } : {}),
      });
      this.store.event("execution.recovery-reviewed", { executionId: id, review });
      return review;
    } finally { this.recovering.delete(id); }
  }
  async recover(id: string) {
    const run = this.recoverRecord(id);
    this.recoveryTasks.add(run);
    try {
      return await run;
    } finally {
      this.recoveryTasks.delete(run);
    }
  }
  private async recoverRecord(id: string) {
    const job = this.store.get("executions", id);
    if (!job) throw new StudioError("执行记录不存在", 404);
    if (!this.factory || !this.policy.allowed || this.stopping)
      throw new StudioError("DSH 恢复当前不可用", 409);
    if (
      this.active.has(id) ||
      this.recovering.has(id) ||
      this.active.size + this.recovering.size >= 2
    )
      throw new StudioError("原执行正在运行或恢复容量已满", 409);
    this.recovering.add(id);
    let connection: DshConnection | undefined;
    try {
      connection = await this.factory({ ...job, recoveryOnly: true }, (m, p) =>
        this.observe(job, m, p),
      );
      this.connections.set(id, connection);
      if (this.stopping) throw Error("Studio stopping");
      await connection.request("initialize", {
        cwd: job.workspace,
        provider: this.policy.provider || "deepseek-account",
        model: this.policy.model || "deepseek-flash",
        ...(job.outputCap == null ? {} : { maxTokens: job.outputCap }),
        ...(job.reasoningEffort
          ? { reasoningEffort: job.reasoningEffort }
          : {}),
      });
      await connection.request("session/resume", { sessionId: job.sessionId });
      return this.store.update("executions", id, {
        nativeResume: "confirmed",
        resumedAt: now(),
        recoveryNote:
          "原 Session 已恢复；未发送 prompt。历史事件不会自动重播，缺失终态仍需核对，不自动重派。",
      });
    } catch {
      return this.store.update("executions", id, {
        nativeResume: "failed",
        recoveryNote:
          "原 Session 未能恢复；保留原标识与状态，未新建或重发任务。",
      });
    } finally {
      await connection?.close().catch(() => {});
      this.connections.delete(id);
      this.recovering.delete(id);
    }
  }
  async stop() {
    this.stopping = true;
    for (const id of this.active.keys())
      this.store.update("executions", id, {
        stopRequested: "interrupt",
        status: "cancelling",
      });
    await Promise.allSettled(
      [...this.connections.values()].map((c) => c.close()),
    );
    await this.drain();
    await Promise.allSettled([...this.recoveryTasks]);
  }
}
