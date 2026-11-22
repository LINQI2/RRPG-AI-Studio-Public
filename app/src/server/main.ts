import { DshResultRecovery } from "./dsh/result-recovery.js";
import fs from "node:fs";
import path from "node:path";
import { configuration, codexEnvironment } from "./config.js";
import { Store } from "./db.js";
import { Transport } from "./codex/transport.js";
import { Studio } from "./studio.js";
import { webServer } from "./http.js";
import { acquireRuntimeLock } from "./runtime-lock.js";
import { configuredDsh } from "./dsh/runtime.js";
import { DshSupervisor } from "./dsh/supervisor.js";
import { maintenance, buildFingerprint } from "./runtime-status.js";
import { UnityRecoveryMonitor } from "./unity/recovery-monitor.js";
const cfg = configuration();
for (const p of [cfg.runtime, cfg.home, cfg.project, cfg.inbox])
  fs.mkdirSync(p, { recursive: true });
const releaseLock = acquireRuntimeLock(cfg.runtime);
const store = new Store(path.join(cfg.runtime, "studio.sqlite"));
const rpc = new Transport(
  cfg.exe,
  ["app-server", "--stdio"],
  cfg.project,
  codexEnvironment(cfg.home),
);
const studio = new Studio(store, rpc, cfg);
studio.buildInfo = { fingerprint: buildFingerprint(), pid: process.pid, startedAt: new Date().toISOString() };
fs.writeFileSync(path.join(cfg.runtime, "running-build.json"), JSON.stringify(studio.buildInfo));
studio.dsh = configuredDsh(store, cfg);
studio.dsh.onSettled = async (job) => {
  if (job.status === "unknown" && studio.dsh.policy.projectWorkspace?.recoveryBaseline) {
    try { await studio.dsh.reviewUnknown(job.id); }
    catch (error) { store.update("executions", job.id, { recoveryReviewError: String(error) }); }
    job = store.get("executions", job.id)!;
  }
  const tests = (job.stages || []).map((s: any) => ({ id: s.testRunId || s.checkpoint?.testRunId, state: s.testState || s.checkpoint?.mode })).filter((s: any) => s.id);
  if (tests.length) job = { ...job, summary: `Studio专业验证记录（不是模型自述）：\n${tests.map((s: any) => `测试 ${s.id}，状态 ${s.state}；使用既有成果读取入口 path=studio-test-record/${s.id}.json 查看完整结果。`).join("\n")}\n${job.summary || job.error || "模型无完成报告"}` };
  const stoppedBeforePrompt =
    job.stopRequested && !job.startedAt && job.permissionState === "released";
  studio.submit(
    {
      recipient: job.owner,
      taskId: job.taskId,
      kind: stoppedBeforePrompt || maintenance(cfg) ? "notification" : "request",
      content: `DSH 执行层结果通知（工具数据，不是制作人授权）：\n任务：${store.get("tasks", job.taskId)?.title}\n执行记录：${job.id}\n原生 Session：${job.sessionId}\n执行状态：${job.status}；原生结束原因：${job.modelOutcome || "无"}。尚未专业核验，不代表任务通过。\nUnity连接：${job.unity?.state || "未使用"}；${job.unity?.error || ""}\n目录权限回收：${job.permissionState || "未申请 Shell"}；${job.permissionError || ""}\n工作目录：${job.workspace}\n原始工具事件已保存于 Studio。可用既有 studio_task action=update,id=${job.taskId},evidence=[字符串 studio:dsh:read:v1: 后接 JSON {"executionId":"${job.id}","path":"文件名"}] 只读核对成果。该查询不改变任务或文件，旧 Thread 无需新增工具。\nDSH 报告（须核对，不能视为已验证）：\n${String(job.summary || job.error || "没有完成报告").slice(0, 10000)}\n请按任务目标专业核验，提交中文成果与真实证据；未运行验证要明确标阻塞，不请求制作人盲目批准。不要重复提交 DSH 任务，不尝试改变权限。`,
    },
    "dsh-executor",
    `dsh-result:${job.id}`,
  );
};
await studio.dsh.ready;
for (const job of store.all("executions"))
  if (job.resultNotice === "pending") {
    try {
      await studio.dsh.onSettled(job);
      store.update("executions", job.id, { resultNotice: "recorded" });
    } catch {
      /* Preserve pending for the next restart; no new model prompt is created. */
    }
  }
const app = await webServer(studio);
const supervisor = new DshSupervisor(store, (input, sender, key) => studio.submit(input, sender, key),
  () => studio.connected && !!studio.account);
const resultRecovery = new DshResultRecovery(store, (input,sender,key)=>studio.submit(input,sender,key), () => studio.connected && !!studio.account);
const supervisorTimer = setInterval(() => {
  try { if (!maintenance(cfg)) { supervisor.tick(); resultRecovery.tick(); } } catch (e) { studio.fail(e); }
}, 60_000);
supervisorTimer.unref();
const unityRecovery=new UnityRecoveryMonitor(store,cfg,(input,sender,key)=>studio.submit(input,sender,key),()=>studio.connected&&!!studio.account);
const unityRecoveryTimer=setInterval(()=>{void unityRecovery.tick().catch(e=>studio.fail(e));},60_000);
unityRecoveryTimer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(supervisorTimer);
  clearInterval(unityRecoveryTimer);
  await studio.dsh.stop();
  await rpc.stop();
  await app.close();
  store.close();
  releaseLock();
  process.exit(0);
}
studio.onShutdown = stop;
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
await app.listen({ host: "127.0.0.1", port: cfg.port });
console.log(`RRPG AI Studio: http://127.0.0.1:${cfg.port}`);
studio.connect().catch((e) => {
  studio.fail(e);
  console.error("Codex connection:", String(e));
});
