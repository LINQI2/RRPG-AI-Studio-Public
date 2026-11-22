import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appRoot, configuration } from "../src/server/config.js";
import { Store } from "../src/server/db.js";
import { DshExecutor } from "../src/server/dsh/executor.js";
import { projectGrant, projectTaskGrant, executionWorkspace } from "../src/server/dsh/project-workspace.js";

it('only explicit authorized task trees inherit, with cycle and owner guards',()=>{
 const tasks:any[]=[{id:'root',owner:'developer',purpose:'product',status:'running'},{id:'child',parentTaskId:'root',owner:'developer',purpose:'product',status:'pending'}];
 const grant={root:'unused',authorization:'approved',taskIds:['old'],taskTreeRoots:['root']};
 expect(projectTaskGrant(tasks[1],tasks,grant)).toBe('root');
 expect(projectTaskGrant(tasks[1],tasks,{...grant,taskTreeRoots:[]})).toBeUndefined();
 expect(projectTaskGrant({...tasks[1],owner:'planner'},tasks,grant)).toBeUndefined();
 expect(projectTaskGrant({...tasks[1],parentTaskId:'missing'},tasks,grant)).toBeUndefined();
 tasks[0].parentTaskId='child';expect(projectTaskGrant(tasks[1],tasks,{...grant,taskTreeRoots:['other']})).toBeUndefined();
 tasks[0].status='completed';expect(projectTaskGrant(tasks[1],tasks,grant)).toBeUndefined();
});

it("project grant is operator-scoped, rejects mismatched root, revoked tasks and Shell", () => {
  const root = fs.mkdtempSync(path.join(appRoot, "runtime/tests/project-grant-"));
  const grant = projectGrant({ enabled: true, root, authorization: "test-only", taskIds: ["one"] }, root)!;
  const job = { taskId: "one", owner: "developer", shellMode: "disabled", workspace: root, projectAuthorization: "test-only" };
  expect(executionWorkspace(job, grant)).toBe(root);
  expect(() => projectGrant({ ...grant, enabled: true, root: path.dirname(root) }, root)).toThrow();
  expect(() => executionWorkspace({ ...job, taskId: "two" }, grant)).toThrow();
  expect(() => executionWorkspace({ ...job, shellMode: "managed" }, grant)).toThrow();
  expect(() => executionWorkspace(job)).toThrow();
  expect(() => executionWorkspace({ ...job, workspace: path.dirname(root) }, grant)).toThrow();
});

it("project file execution uses existing root without ACL lifecycle and serializes uncertain delivery", async () => {
  const root = fs.mkdtempSync(path.join(appRoot, "runtime/tests/project-execution-"));
  fs.writeFileSync(path.join(root, "existing.txt"), "preserve");
  const db = new Store(path.join(root, "test.sqlite"));
  try {
    const task = db.create("tasks", { owner: "developer", executor: "dsh", purpose: "product", status: "pending" });
    const second = db.create("tasks", { owner: "developer", executor: "dsh", purpose: "product", status: "pending" });
    const parent = db.create('tasks',{owner:'developer',purpose:'product',status:'running'});
    db.update('tasks',task.id,{parentTaskId:parent.id});
    let initialized: any;
    const executor = new DshExecutor(db, { ...configuration(), runtime: root, project: root }, {
      allowed: true, source: "simulated", reason: "not real DSH", maxRuntimeMs: 1000,
      projectWorkspace: { root, authorization: "test-only", taskIds: [second.id], taskTreeRoots:[parent.id] },
    }, async (job, event) => ({
      request: async (m, p) => {
        if (m === "initialize") { initialized = p; return { serverInfo: { name: "deepseek-harness-sdk-runtime" } }; }
        if (m === "session/wait") event("session.event", { sessionId: job.sessionId,
          event: { seq: 0, type: "turn/end", data: { reason: { kind: "completed" } } } });
        return {};
      }, close: async () => {},
    }));
    await executor.ready;
    const isolated=db.create('tasks',{owner:'developer',executor:'dsh',purpose:'product',status:'pending'});
    expect(()=>executor.request(isolated.id,{instruction:'write project',clientRequestId:'unbound-project-test',workspace:'project'})).toThrow(/等待工程接入/);
    expect(db.all('executions')).toHaveLength(0);
    expect(()=>executor.request(second.id,{instruction:'test',clientRequestId:'missing-unity-test',stages:[{id:'verify',title:'verify',instruction:'test',check:{kind:'unity-tests',mode:'EditMode'}}]})).toThrow(/等待Unity接入/);
    expect(() => executor.request(task.id, { instruction: "test", clientRequestId: "no-shell-grant", shellMode: "managed" })).toThrow(/Shell/);
    const job = executor.request(task.id, { instruction: "test", clientRequestId: "project-files-test" });
    expect(job.projectGrantRootTaskId).toBe(parent.id);
    expect(() => executor.request(second.id, { instruction: "test", clientRequestId: "project-conflict-test" })).toThrow(/并行/);
    await executor.drain();
    expect(initialized.cwd).toBe(root);
    expect(db.get("executions", job.id)?.status).toBe("finished_unverified");
    expect(db.get("executions", job.id)?.permissionState).toBe("not_requested");
    expect(fs.readFileSync(path.join(root, "existing.txt"), "utf8")).toBe("preserve");
    db.update("executions", job.id, { status: "unknown" });
    expect(() => executor.request(second.id, { instruction: "test", clientRequestId: "project-unknown-test" })).toThrow(/并行/);
  } finally { db.close(); }
});
