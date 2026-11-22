import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Store } from "../src/server/db.js";
import {
  configuration,
  appRoot,
  safePath,
  codexEnvironment,
} from "../src/server/config.js";
import { Transport, RpcError } from "../src/server/codex/transport.js";
import { Studio } from "../src/server/studio.js";
import { webServer } from "../src/server/http.js";
import { Bridge } from "../src/server/bridge.js";
import { NativeQueue } from "../src/server/codex/queue.js";
import { acquireRuntimeLock } from "../src/server/runtime-lock.js";
import { leadInstructionVersion } from "../src/server/codex/tools.js";
const active: Array<() => any> = [];
afterEach(async () => {
  for (const close of active.splice(0).reverse()) await close();
});
const pause = (n = 50) => new Promise((r) => setTimeout(r, n));
it('execution result final replies reach producer, preserving their original source linkage',async()=>{
 const {s,db}=await setup();const threadId=s.agent('developer').threadId;
 db.create('messages',{id:'result-parent',sender:'dsh-executor',recipient:'developer',threadId,turnId:'result-turn',delivery:'completed',taskId:'task'});
 s.projectReply(threadId,'result-turn',{type:'agentMessage',nativeId:'final',text:'尚未完成，需要关闭Play',phase:'final_answer'});
 const reply=db.all('messages').find(m=>m.nativeItemId==='final');
 expect(reply).toMatchObject({recipient:'producer',respondingTo:'dsh-executor',replyTo:'result-parent',delivery:'observed_reply'});
});
it("existing studio_task reads real DSH files without updating task state; identity and traversal are checked", async () => {
  const { s, db, rpc, dir } = await setup();
  const task = s.createTask({
    title: "DSH",
    objective: "文件核验",
    owner: "developer",
    purpose: "product",
    executor: "dsh",
  });
  const workspace = path.join(dir, "dsh-result");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "data.json"), '{"hp":12}');
  const job = db.create("executions", {
    owner: "developer",
    taskId: task.id,
    workspace,
  });
  const prior = JSON.stringify(db.get("tasks", task.id));
  const answers: any[] = [];
  rpc.respond = (_id, result) => answers.push(result);
  await s.serverRequest({
    id: 100,
    method: "item/tool/call",
    params: {
      threadId: s.agent("developer").threadId,
      turnId: "read-turn",
      callId: "read-one",
      tool: "studio_task",
      arguments: {
        action: "update",
        id: task.id,
        evidence: [
          "studio:dsh:read:v1:" +
            JSON.stringify({ executionId: job.id, path: "data.json" }),
        ],
      },
    },
  });
  expect(answers[0].success).toBe(true);
  expect(JSON.stringify(answers[0])).toContain("hp");
  expect(JSON.stringify(db.get("tasks", task.id))).toBe(prior);
  const cs = "namespace Lab { public class Example {} }\n";
  fs.writeFileSync(path.join(workspace, "Example.cs"), cs);
  expect(s.readDshResult(job.id, "Example.cs", "developer")).toMatchObject({
    content: cs, source: "real-dsh-workspace-readback",
  });
  expect(() => s.readDshResult(job.id, "Example.cs", "planner")).toThrow("其他负责人");
  fs.writeFileSync(path.join(workspace, "unsafe.exe"), "binary is never executed/read");
  expect(() => s.readDshResult(job.id, "unsafe.exe", "developer")).toThrow("小型文本");
  expect(JSON.stringify(db.get("tasks", task.id))).toBe(prior);
  expect(() => s.readDshResult(job.id, "data.json", "planner")).toThrow(
    "其他负责人",
  );
  expect(() => s.readDshResult(job.id, "../outside.txt", "developer")).toThrow(
    "outside",
  );
  const app = await webServer(s);
  active.push(() => app.close());
  const session = await app.inject({
    url: "/api/session",
    headers: { host: "127.0.0.1" },
  });
  const cookie = String(session.headers["set-cookie"]).split(";")[0];
  const view = await app.inject({
    url:
      "/api/artifact?path=" +
      encodeURIComponent(`dsh-result/${job.id}/data.json`),
    headers: { host: "127.0.0.1", cookie },
  });
  expect(view.statusCode).toBe(200);
  expect(view.json().content).toBe('{"hp":12}');
});
it.skipIf(process.platform !== "win32")(
  "Windows execution preflight reports backend readiness without granting permissions or claiming model success",
  async () => {
    const { s, rpc, db } = await setup();
    const calls: string[] = [];
    rpc.call = async (method: string) => {
      calls.push(method);
      return { status: "notConfigured" };
    };
    await s.inspectExecution();
    expect(s.diagnostics.execution).toMatchObject({
      status: "requires-attention",
      nativeReadiness: "notConfigured",
    });
    expect(db.events(0).some((e) => e.type === "execution.preflight")).toBe(
      true,
    );
    rpc.call = async (method: string) => {
      calls.push(method);
      return { status: "ready" };
    };
    await s.inspectExecution();
    expect(s.diagnostics.execution.status).toBe("unverified");
    rpc.call = async (method: string) => {
      calls.push(method);
      throw Error("unsupported");
    };
    await s.inspectExecution();
    expect(s.diagnostics.execution.reason).toContain("unsupported");
    expect(calls).toEqual(Array(3).fill("windowsSandbox/readiness"));
  },
);
async function setup() {
  fs.mkdirSync(path.join(appRoot, "runtime/tests"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(appRoot, "runtime/tests/case-"));
  const cfg = {
    ...configuration(),
    runtime: dir,
    home: path.join(dir, "home"),
    project: path.join(dir, "project"),
    inbox: path.join(dir, "inbox"),
  };
  for (const p of [cfg.home, cfg.project, cfg.inbox])
    fs.mkdirSync(p, { recursive: true });
  const db = new Store(path.join(dir, "test.sqlite"));
  const rpc = new Transport(
    process.execPath,
    [path.join(appRoot, "tests/fake-server.mjs")],
    dir,
    { ...process.env, FAKE_STATE: path.join(dir, "fake-state.json") },
    1000,
  );
  const s = new Studio(db, rpc, cfg);
  active.push(() => db.close());
  active.push(() => rpc.stop());
  await s.connect();
  await s.initialize();
  return { s, db, rpc, dir, cfg };
}
describe("task parent relationships",()=>{
 it("technical assistance classification preserves facts, has one bounded owner review and cannot approve anything",async()=>{
   const {s,db,rpc}=await setup();rpc.respond=()=>{};
   const task=s.createTask({title:"技术工作",objective:"原范围",owner:"developer"});
   const threadId=s.agent("developer").threadId;
   const args={audience:"technical",question:"请维护端核对工具结果",facts:"原结果未知",options:["先核对"],taskId:task.id};
   for(const callId of ["a","b"])await s.serverRequest({id:9,method:"item/tool/call",params:{threadId,turnId:"same",callId,tool:"studio_request_decision",arguments:callId==="a"?args:{...args,audience:undefined,question:"【技术协助】请维护端核对工具结果"}}});
   expect(db.all("decisions")).toHaveLength(2);expect(db.all("messages").filter(m=>m.sender==="technical-recovery")).toHaveLength(1);
   const d=db.all("decisions")[0];const routed=s.routeDecision(d.id,"producer","经核对涉及产品决策",d.updatedAt);
   expect(routed.status).toBe("open");expect(routed.question).toBe(d.question);expect(routed.facts).toBe(d.facts);expect(routed.answer).toBeUndefined();
 });
 it("new native work packages inherit the unique trusted incoming task context",async()=>{
   const {s,db,rpc}=await setup();
   const p=s.createTask({title:"总目标",objective:"目标",owner:"developer"});
   const threadId=s.agent("developer").threadId;
   db.create("messages",{id:"context-message",taskId:p.id});
   db.create("runs",{id:`${threadId}:context-turn`,linkedMessages:["context-message"]});
   let answer:any;rpc.respond=(_id,result)=>{answer=result;};
   await s.serverRequest({id:99,method:"item/tool/call",params:{threadId,turnId:"context-turn",callId:"work-package",tool:"studio_task",arguments:{action:"create",title:"工作包",objective:"子范围"}}});
   expect(answer.success).toBe(true);
   expect(db.all("tasks").find(t=>t.title==="工作包")?.parentTaskId).toBe(p.id);
 });
 it("audits reparenting without changing task execution or authority and rejects cycles/stale edits",async()=>{
   const {s,db}=await setup();
   const p=s.createTask({title:"父任务",objective:"目标",owner:"developer"});
   const c=s.createTask({title:"子任务",objective:"子目标",owner:"developer",parentTaskId:p.id});
   const before=db.get("tasks",c.id)!;
   expect(()=>s.setTaskParent(p.id,c.id,"形成循环",p.updatedAt)).toThrow(/成环/);
   expect(()=>s.setTaskParent(c.id,null,"调整","old")).toThrow(/变化/);
   const result=s.setTaskParent(c.id,null,"经核对为独立目标",before.updatedAt);
   expect(result.status).toBe(before.status);expect(result.contract).toEqual(before.contract);expect(result.parentTaskId).toBeNull();
   expect(db.events(0,1000).some(e=>e.type==="task.parent_changed")).toBe(true);
   expect(()=>s.createTask({title:"坏关系",objective:"目标",owner:"developer",parentTaskId:"absent"})).toThrow(/不存在/);
 });
});
describe("P1 durable messaging and protocol boundary", () => {
  it("deduplicates submissions and rejects conflicting payloads", async () => {
    const { s, db } = await setup();
    const first = s.submit(
      { recipient: "planner", content: "one" },
      "producer",
      "same-key",
    );
    const again = s.submit(
      { recipient: "planner", content: "one" },
      "producer",
      "same-key",
    );
    expect(again.id).toBe(first.id);
    expect(() =>
      s.submit(
        { recipient: "planner", content: "two" },
        "producer",
        "same-key",
      ),
    ).toThrow("Idempotency");
    await pause(300);
    expect(db.all("runs")).toHaveLength(1);
    expect(db.get("messages", first.id)?.delivery).toBe("completed");
  });
  it("serializes busy lead input while allowing independent other lead", async () => {
    const { s, db } = await setup();
    s.submit({ recipient: "planner", content: "SLOW one" });
    s.submit({ recipient: "planner", content: "two" });
    s.submit({ recipient: "developer", content: "independent" });
    await pause(300);
    expect(
      db.all("runs").filter((r) => r.threadId === s.agent("planner").threadId),
    ).toHaveLength(1);
    expect(
      db.all("messages").find((m) => m.content === "independent")?.delivery,
    ).toBe("completed");
    await pause(1300);
    expect(
      db
        .all("messages")
        .filter((m) => m.recipient === "planner")
        .every((m) => m.delivery === "completed"),
    ).toBe(true);
  });
  it("does not overwrite a final event arriving before RPC acknowledgement", async () => {
    const { s, db } = await setup();
    const m = s.submit({ recipient: "planner", content: "EARLY_FINAL" });
    await pause(150);
    expect(db.get("messages", m.id)?.delivery).toBe("completed");
    expect(db.all("runs")[0].status).toBe("completed");
  });
  it("deduplicates final events and preserves final item against stale start", async () => {
    const { s, db } = await setup();
    const tid = s.agent("planner").threadId;
    const p = {
      threadId: tid,
      turnId: "t",
      item: { id: "i", type: "agentMessage", text: "result" },
    };
    s.notification({ method: "item/completed", params: p });
    const seq = db.cursor();
    s.notification({ method: "item/completed", params: p });
    expect(db.cursor()).toBe(seq);
    s.notification({
      method: "item/started",
      params: { ...p, item: { ...p.item, text: "" } },
    });
    expect(db.all("items")[0].text).toBe("result");
  });
  it("keeps unknown dispatch blocked across reconciliation with no matching client ID", async () => {
    const { s, db } = await setup();
    const m = s.submit({ recipient: "planner", content: "unknown" });
    db.update("messages", m.id, { delivery: "unknown" });
    s.resumed.clear();
    await s.reconcile("planner");
    expect(s.agent("planner").status).toBe("unknown");
    await s.pump("planner");
    expect(db.all("runs")).toHaveLength(0);
  });
  it("matches historical user client IDs without resending", async () => {
    const { s, db } = await setup();
    const m = s.submit({ recipient: "planner", content: "history" });
    await pause(250);
    db.update("messages", m.id, { delivery: "unknown", turnId: null });
    await s.reconcile("planner");
    expect(db.get("messages", m.id)?.delivery).toBe("completed");
    expect(db.all("runs")).toHaveLength(1);
  });
  it("rejects stale steer and waits for actual interrupted final state", async () => {
    const { s } = await setup();
    s.submit({ recipient: "planner", content: "SLOW" });
    await pause(100);
    const tid = s.agent("planner").activeTurnId;
    await expect(
      s.control("planner", "steer", { turnId: "stale", content: "x" }),
    ).rejects.toThrow("changed");
    await s.control("planner", "steer", {
      turnId: tid,
      content: "new direction",
    });
    await s.control("planner", "interrupt", { turnId: tid });
    expect(s.agent("planner").status).toBe("idle");
  });
  it("cleans pending timeouts, tolerates invalid frames and split UTF8", async () => {
    const { rpc } = await setup();
    let text = "";
    rpc.on("notification", (m) => {
      if (m.method === "fixture/unicode") text = m.params.text;
    });
    await rpc.call("fixture/invalid");
    await rpc.call("fixture/split");
    await pause();
    expect(text).toBe("中文分片");
    await expect(rpc.call("fixture/timeout", {}, 30)).rejects.toThrow(
      "unknown",
    );
    expect(rpc.pending.size).toBe(0);
  });
  it("preserves data through consistent backup and a new store", async () => {
    const { s, db, dir } = await setup();
    s.createTask({
      owner: "planner",
      title: "saved",
      objective: "check",
      acceptance: "producer",
    });
    const target = path.join(dir, "backup.sqlite");
    await db.backup(target);
    const restored = new Store(target);
    active.push(() => restored.close());
    expect(restored.all("tasks")[0].title).toBe("saved");
    expect(restored.db.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
  });

});
describe("P2 identity, asynchronous collaboration and cancellation", () => {
  it("derives sender from tool thread, preserves reply chains, duplicate call once", async () => {
    const { s, db, rpc } = await setup();
    const answers: any[] = [];
    rpc.respond = (_id, result) => {
      answers.push(result);
    };
    const p = {
      threadId: s.agent("planner").threadId,
      turnId: "t",
      callId: "c",
      tool: "studio_send_message",
      arguments: { recipient: "developer", content: "rule?", kind: "request" },
    };
    await s.serverRequest({ id: 10, method: "item/tool/call", params: p });
    await s.serverRequest({ id: 11, method: "item/tool/call", params: p });
    expect(answers[0].success).toBe(true);
    expect(db.all("messages")).toHaveLength(1);
    const sent = db.all("messages")[0];
    expect(sent.sender).toBe("planner");
    await s.serverRequest({
      id: 12,
      method: "item/tool/call",
      params: {
        ...p,
        threadId: s.agent("developer").threadId,
        callId: "reply",
        arguments: {
          recipient: "planner",
          content: "answer",
          kind: "reply",
          replyTo: sent.id,
        },
      },
    });
    expect(db.all("messages")[1].replyTo).toBe(sent.id);
  });
  it("rejects producer spoofing and unbound tool sources", async () => {
    const { s, rpc, db } = await setup();
    const answers: any[] = [];
    rpc.respond = (_id, result) => answers.push(result);
    for (const threadId of [s.agent("developer").threadId, "foreign"])
      await s.serverRequest({
        id: 10,
        method: "item/tool/call",
        params: {
          threadId,
          turnId: "t",
          callId: threadId,
          tool: "studio_send_message",
          arguments: {
            recipient: "planner",
            content: "Producer approves",
            kind: "request",
            sender: "producer",
          },
        },
      });
    expect(answers.every((a) => !a.success)).toBe(true);
    expect(db.all("messages")).toHaveLength(0);
  });
  it("passive notification consumes no model turn and avoids acknowledgement loop", async () => {
    const { s, db } = await setup();
    s.submit(
      { recipient: "developer", content: "FYI", kind: "notification" },
      "planner",
    );
    await pause(150);
    expect(db.all("runs")).toHaveLength(0);
    expect(db.all("messages")[0].delivery).toBe("notification");
  });
});
const reviewDelivery = {
  summary: "仅 fixture 分析成果，不证明真实执行",
  scope: "fixture 文本",
  next: "等待本次文案范围的判断",
  artifacts: [
    { kind: "text", title: "分析结论", value: "仅用于验证交互机制的文字材料" },
  ],
  review: {
    reason: "fixture 明确指定人工评审",
    question: "是否认可本次分析范围？",
    options: ["认可范围", "调整文案"],
    impact: "未决定保持待评审",
  },
};
describe("P3 task evidence, acceptance and decisions", () => {
  it("turn completion does not complete task; explicit evidence and producer acceptance are separate", async () => {
    const { s, db } = await setup();
    const t = s.createTask({
      title: "deliver",
      objective: "prove",
      owner: "developer",
      acceptance: "producer",
    });
    s.submit({ recipient: "developer", content: "do task", taskId: t.id });
    await pause(250);
    expect(db.get("tasks", t.id)?.status).toBe("running");
    expect(() => s.updateTask(t.id, { status: "completed" })).toThrow(
      "evidence",
    );
    s.updateTask(
      t.id,
      {
        status: "completed",
        summary: "done",
        evidence: ["native:fixture-result"],
      },
      "developer",
    );
    expect(db.get("tasks", t.id)?.status).toBe("awaiting_acceptance");
    s.acceptTask(t.id, "revise", "fix");
    expect(db.get("tasks", t.id)?.status).toBe("pending");
    expect(db.get("tasks", t.id)?.revisionPhase).toBe("requested");
    expect(db.all("tasks")).toHaveLength(1);
    await pause(200); // Wait for the actual fixture revision message's terminal event.
    s.updateTask(
      t.id,
      {
        status: "completed",
        summary: "fixed",
        evidence: ["native:fixture-result-2"],
        delivery: reviewDelivery,
      },
      "developer",
    );
    s.acceptTask(t.id, "approve", "ok");
    expect(db.get("tasks", t.id)?.status).toBe("completed");
  });
  it("autonomous task completes with evidence, foreign lead cannot change it", async () => {
    const { s } = await setup();
    const t = s.createTask({
      owner: "planner",
      title: "task",
      objective: "result",
    });
    expect(() =>
      s.updateTask(
        t.id,
        { status: "completed", summary: "x", evidence: ["file:readme"] },
        "developer",
      ),
    ).toThrow("owner");
    expect(
      s.updateTask(
        t.id,
        { status: "completed", summary: "x", evidence: ["file:readme"] },
        "planner",
      ).status,
    ).toBe("completed");
  });
  it("producer decision returns to same lead Thread and peers cannot forge it", async () => {
    const { s, db, rpc } = await setup();
    rpc.respond = () => {};
    await s.serverRequest({
      id: 1,
      method: "item/tool/call",
      params: {
        threadId: s.agent("planner").threadId,
        turnId: "t",
        callId: "d",
        tool: "studio_request_decision",
        arguments: {
          question: "choose",
          facts: "unknown",
          options: ["A", "B"],
        },
      },
    });
    const d = db.all("decisions")[0];
    s.decide(d.id, "A");
    const m = db.all("messages")[0];
    expect(m.sender).toBe("producer");
    expect(m.threadId).toBe(s.agent("planner").threadId);
    expect(db.get("decisions", d.id)?.answeredBy).toBe("producer");
  });
});
describe("P4 Lab handoff and filesystem protection", () => {
  it("discovers once, rejects reused identity with changed content, notifies once", async () => {
    const { s, cfg, db } = await setup();
    const b = new Bridge(s);
    const file = path.join(cfg.inbox, "h.json");
    const doc = {
      id: "handoff-1",
      title: "design",
      content: "test design",
      producerConfirmed: true,
      provenance: "producer fixture",
    };
    fs.writeFileSync(file, JSON.stringify(doc));
    expect(b.scan().imported).toBe(1);
    expect(b.scan().imported).toBe(0);
    b.notify(doc.id);
    b.notify(doc.id);
    expect(db.all("tasks")).toHaveLength(1);
    expect(db.all("messages")).toHaveLength(1);
    b.record(doc.id, {
      summary: "reviewed",
      evidence: ["native:fixture-review"],
    });
    expect(db.all("messages")[1].recipient).toBe("developer");
    fs.writeFileSync(file, JSON.stringify({ ...doc, content: "changed" }));
    expect(b.scan().errors).toHaveLength(1);
  });
  it("rejects paths outside authorized Lab and malformed/oversized handoffs", async () => {
    const { s, cfg } = await setup();
    expect(() => safePath(appRoot, "D:\\Example\\OutsideProject")).toThrow("outside");
    fs.writeFileSync(path.join(cfg.inbox, "bad.json"), "{}");
    expect(new Bridge(s).scan().errors).toHaveLength(1);
  });
});
describe("HTTP security and durable API", () => {
  it("rejects foreign origins, text/plain, invalid CSRF and forged sender", async () => {
    const { s } = await setup();
    const app = await webServer(s);
    active.push(() => app.close());
    const sess = await app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1" },
    });
    const cookie = sess.headers["set-cookie"]!.toString().split(";")[0],
      csrf = sess.json().csrf;
    const body = {
      recipient: "planner",
      content: "one",
      clientRequestId: "request-1",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/messages",
          headers: {
            host: "127.0.0.1",
            origin: "https://evil.example",
            cookie,
            "x-studio-csrf": csrf,
          },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/messages",
          headers: {
            host: "127.0.0.1",
            cookie,
            "content-type": "text/plain",
            "x-studio-csrf": csrf,
          },
          payload: JSON.stringify(body),
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/messages",
          headers: { host: "127.0.0.1", cookie },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/messages",
          headers: { host: "127.0.0.1", cookie, "x-studio-csrf": csrf },
          payload: { ...body, sender: "producer" },
        })
      ).statusCode,
    ).toBe(400);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { host: "127.0.0.1", cookie, "x-studio-csrf": csrf },
      payload: body,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().delivery).toBe("recorded");
  });
});
describe("P5 recovery, queue contract and event delivery", () => {
  it("isolates Desktop identity and IPC while retaining explicit Studio home and normal environment", () => {
    const env = codexEnvironment("lab-home", {
      PATH: "bin",
      HTTPS_PROXY: "proxy",
      CODEX_HOME: "foreign",
      CODEX_THREAD_ID: "foreign-thread",
      CODEX_PERMISSION_PROFILE: "foreign-profile",
      CODEX_APP_TOOLS_PIPE_PATH: "foreign-pipe",
    });
    expect(env).toEqual({
      PATH: "bin",
      HTTPS_PROXY: "proxy",
      CODEX_HOME: "lab-home",
    });
  });
  it("remote internal errors do not prove non-execution or permit replay", async () => {
    const { s, rpc, db } = await setup();
    let attempts = 0;
    const call = rpc.call.bind(rpc);
    rpc.call = async (method: string, params: any = {}, timeout?: number) => {
      if (method === "turn/start") {
        attempts++;
        throw new RpcError("internal error after possible acceptance", -32603);
      }
      return call(method, params, timeout);
    };
    const m = s.submit({
      recipient: "planner",
      content: "uncertain remote error",
    });
    await pause(100);
    expect(db.get("messages", m.id)?.delivery).toBe("unknown");
    s.submit({ recipient: "planner", content: "later work" });
    await pause(100);
    expect(attempts).toBe(1);
  });
  it("repairs only a proven missing empty binding after cancelling unexecuted input", async () => {
    const { s, rpc, db } = await setup();
    const old = s.agent("developer").threadId;
    s.account = null;
    const message = s.submit({ recipient: "developer", content: "never sent" });
    await expect(s.recreateMissing("developer")).rejects.toThrow(
      "recorded activity",
    );
    s.cancelMessage(message.id);
    s.account = { type: "fixture" };
    const call = rpc.call.bind(rpc);
    rpc.call = async (method: string, params: any = {}, timeout?: number) => {
      if (method === "thread/resume" && params.threadId === old)
        throw new RpcError("no rollout found for thread id " + old, -32602);
      return call(method, params, timeout);
    };
    await s.recreateMissing("developer");
    expect(s.agent("developer").threadId).not.toBe(old);
    expect(db.all("agents")).toHaveLength(2);
    expect(db.get("messages", message.id)?.threadId).toBe(old);
    expect(db.get("messages", message.id)?.delivery).toBe("cancelled");
  });
  it("rejects a second dispatcher and only cancels proven undispatched input", async () => {
    const { s, dir, db } = await setup();
    const release = acquireRuntimeLock(dir);
    expect(() => acquireRuntimeLock(dir)).toThrow("Another Studio");
    release();
    s.account = null;
    const m = s.submit({
      recipient: "planner",
      content: "queued without auth",
    });
    expect(s.cancelMessage(m.id).delivery).toBe("cancelled");
    db.update("messages", m.id, { delivery: "unknown" });
    expect(() => s.cancelMessage(m.id)).toThrow("proven");
  });
  it("observer failure cannot roll back or falsely reject a committed input", async () => {
    const { s, db } = await setup();
    db.on("changed", () => {
      throw Error("disconnected observer");
    });
    const m = s.submit(
      { recipient: "planner", content: "committed" },
      "producer",
      "durable-key",
    );
    expect(db.get("messages", m.id)).toBeDefined();
    expect(
      s.submit(
        { recipient: "planner", content: "committed" },
        "producer",
        "durable-key",
      ).id,
    ).toBe(m.id);
  });
  it("native queue adapter uses receipts separately from outbox", async () => {
    const { s, rpc, db } = await setup();
    const q = new NativeQueue(rpc);
    const tid = s.agent("planner").threadId;
    const r = await q.add(tid, "client-native", "native text");
    expect((await q.list(tid))[0].id).toBe(r.queuedSubmission.id);
    const started = await q.start(tid, r.queuedSubmission.id);
    expect(started.turn.id).toContain("turn-");
    expect(await q.list(tid)).toEqual([]);
    expect(db.all("messages")).toHaveLength(0);
  });
  it("transport loss marks pending execution unknown and never silently repeats it", async () => {
    const { s, rpc, db, dir, cfg } = await setup();
    const m = s.submit({
      recipient: "planner",
      content: "SLOW crash boundary",
    });
    await pause(100);
    await rpc.stop();
    expect(db.get("messages", m.id)?.delivery).toBe("unknown");
    const nextRpc = new Transport(
      process.execPath,
      [path.join(appRoot, "tests/fake-server.mjs")],
      dir,
      { ...process.env, FAKE_STATE: path.join(dir, "fake-state.json") },
    );
    active.push(() => nextRpc.stop());
    const next = new Studio(db, nextRpc, cfg);
    await next.connect();
    await pause(150);
    expect(db.get("messages", m.id)?.delivery).toBe("unknown");
    expect(next.agent("planner").status).toBe("unknown");
    expect(db.all("runs")).toHaveLength(1);
  });
  it("native Goal lifecycle is user-controlled; active Goal prevents implicit resume", async () => {
    const { s, rpc } = await setup();
    await s.control("planner", "goal", {
      action: "active",
      objective: "fixture goal",
    });
    s.resumed.clear();
    await expect(s.reconcile("planner")).rejects.toThrow("Active native Goal");
    await s.control("planner", "goal", { action: "paused" });
    await s.reconcile("planner");
    await s.control("planner", "goal", { action: "clear" });
    expect(
      (
        await rpc.call("thread/goal/get", {
          threadId: s.agent("planner").threadId,
        })
      ).goal,
    ).toBeNull();
  });
  it("all question answers required and stale server request is never replayed after restart", async () => {
    const { s, rpc, db, cfg } = await setup();
    rpc.respond = () => {};
    await s.serverRequest({
      id: 901,
      method: "tool/requestUserInput",
      params: {
        threadId: s.agent("planner").threadId,
        turnId: "t",
        questions: [
          { id: "a", question: "A" },
          { id: "b", question: "B" },
        ],
      },
    });
    const request = db.all("requests")[0];
    expect(() =>
      s.answerRequest(request.id, { a: { answers: ["yes"] } }),
    ).toThrow("every");
    new Studio(db, rpc, cfg);
    expect(() =>
      s.answerRequest(request.id, {
        a: { answers: ["yes"] },
        b: { answers: ["yes"] },
      }),
    ).toThrow("unavailable");
  });
  it("replays durable SSE cursor and shuts down with open streams", async () => {
    const { s, db } = await setup();
    const app = await webServer(s);
    active.push(() => app.close());
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as any;
    const root = `http://127.0.0.1:${address.port}`;
    const session = await fetch(root + "/api/session");
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    const after = db.cursor();
    const abort = new AbortController();
    const stream = await fetch(root + `/api/events?after=${after}`, {
      headers: { cookie },
      signal: abort.signal,
    });
    const reader = stream.body!.getReader();
    db.atomic(() => db.event("sse.proof", { marker: "persistent-event" }));
    const data = new TextDecoder().decode((await reader.read()).value);
    expect(data).toContain("persistent-event");
    expect(data).toContain("id: " + db.cursor());
    abort.abort();
    await reader.cancel().catch(() => {});
  });
});

it("updates both original lead instructions on resume, preserving binding, conversation and read-only permissions", async () => {
  const { s, rpc, db } = await setup();
  const message = s.submit(
    { recipient: "planner", content: "保留这条既有历史" },
    "producer",
  );
  await pause(200);
  const originalIds = s.store.all("agents").map((a) => a.threadId);
  const oldMessage = { ...db.get("messages", message.id) };
  const calls: any[] = [];
  const original = rpc.call.bind(rpc);
  rpc.call = async (method: string, params: any = {}) => {
    calls.push({ method, params });
    return original(method, params);
  };
  for (const role of ["planner", "developer"]) {
    db.update("agents", role, { instructionVersion: "old" });
    await s.restore(role);
  }
  const resumes = calls.filter((c) => c.method === "thread/resume");
  expect(resumes).toHaveLength(2);
  for (const r of resumes) {
    expect(r.params.developerInstructions).toContain("默认使用简体中文");
    expect(r.params.developerInstructions).toContain("read-only / never");
    expect(r.params.sandbox).toBe("read-only");
    expect(r.params.approvalPolicy).toBe("never");
  }
  expect(calls.some((c) => c.method === "thread/start")).toBe(false);
  expect(s.store.all("agents").map((a) => a.threadId)).toEqual(originalIds);
  expect(db.get("messages", message.id)?.content).toBe(oldMessage.content);
  expect(
    s.store
      .all("agents")
      .every((a) => a.instructionVersion === leadInstructionVersion),
  ).toBe(true);
});
it("does not mark communication instructions applied when native resume rejects", async () => {
  const { s, rpc, db } = await setup();
  db.update("agents", "developer", { instructionVersion: "old" });
  const original = rpc.call.bind(rpc);
  rpc.call = async (method: string, params: any = {}) => {
    if (method === "thread/resume") throw Error("native resume rejected");
    return original(method, params);
  };
  await expect(s.restore("developer")).rejects.toThrow("rejected");
  expect(s.agent("developer").instructionVersion).toBe("old");
});

it("attaches the current role policy on each new turn without replacing submitted text or widening execution", async () => {
  const { s, rpc } = await setup();
  const starts: any[] = [];
  const call = rpc.call.bind(rpc);
  rpc.call = async (method: string, params: any = {}) => {
    if (method === "turn/start") starts.push(params);
    return call(method, params);
  };
  for (const role of ["planner", "developer"]) {
    s.submit(
      { recipient: role, content: "English input retained exactly" },
      "producer",
    );
    await pause(250);
  }
  expect(starts).toHaveLength(2);
  for (const params of starts) {
    expect(params.additionalContext["rrpg-studio-role"].kind).toBe(
      "application",
    );
    expect(params.additionalContext["rrpg-studio-role"].value).toContain(
      "默认使用简体中文",
    );
    expect(params.input[0].text).toContain("English input retained exactly");
    expect(params.approvalPolicy).toBe("never");
    expect(params.sandboxPolicy).toEqual({ type: "readOnly" });
    expect(params.collaborationMode).toBeUndefined();
  }
});

describe("producer task actions are durable, explicit and atomic", () => {
  const body = (
    s: Studio,
    t: any,
    action: string,
    comment = "明确的测试反馈",
  ) => ({
    action,
    comment,
    clientRequestId: crypto.randomUUID(),
    expectedUpdatedAt: t.updatedAt,
    expectedStatus: t.status,
    bindingRevision: s.agent(t.owner).revision,
  });
  async function delivered() {
    const x = await setup();
    const t = x.s.createTask({
      title: "仅分析的交付",
      objective: "只验证分析结论",
      owner: "developer",
      acceptance: "producer",
    });
    return {
      ...x,
      t: x.s.updateTask(
        t.id,
        {
          status: "completed",
          summary: "仅理论分析，未执行代码",
          evidence: ["fixture:analysis-only"],
          delivery: reviewDelivery,
        },
        "developer",
      ),
    };
  }
  it("discussion remains awaiting acceptance, repeats use one message, revisions preserve old delivery", async () => {
    const { s, db, t } = await delivered();
    const input = body(s, t, "discuss");
    const first = s.taskAction(t.id, input);
    const replay = s.taskAction(t.id, input);
    expect(replay.message?.id).toBe(first.message?.id);
    expect(db.get("tasks", t.id)?.status).toBe("awaiting_acceptance");
    expect(db.all("messages")).toHaveLength(1);
    expect(first.message?.threadId).toBe(s.agent("developer").threadId);
    expect(() => s.taskAction(t.id, body(s, first.task, "approve"))).toThrow(
      "待处理",
    );
    expect(() => s.taskAction(t.id, { ...input, comment: "不同内容" })).toThrow(
      "冲突",
    );
    await pause(200);
    const current = db.get("tasks", t.id)!;
    const revised = s.taskAction(t.id, body(s, current, "revise", "补充反例"));
    expect(revised.task.status).toBe("pending");
    expect(revised.task.revisionPhase).toBe("requested");
    expect(revised.task.evidence).toEqual(t.evidence);
    expect(revised.task.actionHistory[1].deliverySnapshot.summary).toBe(
      t.summary,
    );
  });
  it("unavailable owner, blank feedback and stale task cause no task or message mutations", async () => {
    const { s, db, t } = await delivered();
    const input = body(s, t, "revise");
    expect(() =>
      s.taskAction(t.id, {
        ...input,
        bindingRevision: input.bindingRevision + 1,
      }),
    ).toThrow("绑定已变化");
    expect(() => s.taskAction(t.id, { ...input, comment: "  " })).toThrow(
      "填写",
    );
    expect(() =>
      s.taskAction(t.id, { ...input, expectedUpdatedAt: "stale" }),
    ).toThrow("变化");
    db.update("agents", "developer", { status: "unknown" });
    expect(() => s.taskAction(t.id, input)).toThrow("不可用");
    expect(db.get("tasks", t.id)).toEqual(t);
    expect(db.all("messages")).toHaveLength(0);
  });
  it("a persistence failure rolls back task, message, receipt and event, with no model dispatch", async () => {
    const { s, db, t, rpc } = await delivered();
    const events = db.cursor();
    const put = db.put.bind(db);
    let starts = 0;
    const call = rpc.call.bind(rpc);
    rpc.call = async (method, params) => {
      if (method === "turn/start") starts++;
      return call(method, params);
    };
    db.put = (table, row) => {
      if (table === "messages") throw Error("injected database failure");
      return put(table, row);
    };
    expect(() => s.taskAction(t.id, body(s, t, "revise"))).toThrow("injected");
    expect(db.get("tasks", t.id)).toEqual(t);
    expect(db.cursor()).toBe(events);
    expect(db.all("messages")).toHaveLength(0);
    expect(starts).toBe(0);
  });
  it("start, continue and resend do not create tasks or change ownership, reject in-flight duplicate", async () => {
    const { s, db } = await setup();
    const t = s.createTask({
      title: "new",
      objective: "bounded",
      owner: "developer",
    });
    const first = s.taskAction(
      t.id,
      body(s, t, "start", "SLOW test instruction"),
    );
    expect(() => s.taskAction(t.id, body(s, first.task, "continue"))).toThrow(
      "待处理",
    );
    await pause(1500);
    const completed = s.updateTask(t.id, {
      status: "completed",
      summary: "fixture only",
      evidence: ["fixture:test"],
    });
    expect(() => s.taskAction(t.id, body(s, completed, "start"))).toThrow(
      "当前状态",
    );
    const repeat = s.taskAction(
      t.id,
      body(s, completed, "resend", "重新分析同一案例，不执行文件"),
    );
    expect(repeat.task.id).toBe(t.id);
    expect(repeat.task.owner).toBe("developer");
    expect(db.all("tasks")).toHaveLength(1);
    expect(repeat.message?.threadId).toBe(first.message?.threadId);
  });
  it("approval is an explicit producer record, not a model or execution assertion", async () => {
    const { s, db, t } = await delivered();
    const approved = s.taskAction(
      t.id,
      body(s, t, "approve", "仅验收理论文案，不验收文件执行"),
    );
    expect(approved.message).toBeNull();
    expect(approved.task.status).toBe("completed");
    expect(approved.task.acceptanceHistory[0].actor).toBe("producer");
    expect(db.all("messages")).toHaveLength(0);
    expect(approved.task.evidence).toEqual(t.evidence);
  });
});
describe("W1 task transitions and immutable delivery versions", () => {
  it("all update paths enforce required real checks; stale delivery cannot validate a new version", async () => {
    const { s, db } = await setup();
    const t = s.createTask({
      title: "真实执行目标",
      objective: "必须真实执行；本测试不实际运行模型命令",
      owner: "developer",
      contract: { kind: "implementation" },
    });
    const base = {
      summary: "模拟内容",
      scope: "fixture",
      next: "补齐真实验证",
      artifacts: [{ title: "文字说明", kind: "text", value: "不是执行成果" }],
      checks: [
        {
          id: "execution",
          title: "实际执行",
          result: "passed",
          mode: "simulated",
          evidence: ["fixture:模拟"],
        },
      ],
    };
    expect(() =>
      s.updateTask(
        t.id,
        { status: "completed", summary: "非空", evidence: ["非空"] },
        "developer",
      ),
    ).toThrow("完成条件");
    expect(() =>
      s.updateTask(
        t.id,
        { status: "completed", evidence: ["fixture"], delivery: base },
        "developer",
      ),
    ).toThrow("完成条件");
    expect(db.all("deliveries")).toHaveLength(0);
    const valid = { ...base, checks: [{ ...base.checks[0], mode: "real" }] };
    s.updateTask(
      t.id,
      {
        status: "completed",
        evidence: ["fixture 声明，不是实测证据"],
        delivery: valid,
      },
      "developer",
    );
    const first = JSON.stringify(db.all("deliveries")[0]);
    expect(() =>
      s.updateTask(
        t.id,
        { status: "completed", summary: "改过的新版本", evidence: ["新引用"] },
        "developer",
      ),
    ).toThrow("完成条件");
    s.updateTask(
      t.id,
      {
        status: "blocked",
        evidence: ["fixture:new"],
        delivery: {
          ...base,
          summary: "验证阻塞",
          checks: [{ ...base.checks[0], result: "blocked", mode: "unknown" }],
        },
      },
      "developer",
    );
    expect(db.all("deliveries")).toHaveLength(2);
    expect(JSON.stringify(db.all("deliveries")[0])).toBe(first);
    expect(db.get("tasks", t.id)?.status).toBe("blocked");
  });
  it("explicit human review cannot be approved without readable materials; routine work cannot self-escalate to acceptance", async () => {
    const { s } = await setup();
    const t = s.createTask({
      title: "文字",
      objective: "分析",
      owner: "planner",
    });
    expect(() =>
      s.updateTask(
        t.id,
        { status: "awaiting_acceptance", summary: "分析", evidence: ["引用"] },
        "planner",
      ),
    ).toThrow("普通专业工作");
    const human = s.createTask({
      title: "指定评审",
      objective: "仅文本",
      owner: "developer",
      acceptance: "producer",
    });
    const waiting = s.updateTask(
      human.id,
      { status: "completed", summary: "无材料", evidence: ["引用"] },
      "developer",
    );
    expect(waiting.status).toBe("awaiting_acceptance");
    expect(() => s.acceptTask(human.id, "approve", "盲批")).toThrow("评审材料");
    expect(() =>
      s.updateTask(human.id, { status: "completed", summary: "" }, "developer"),
    ).toThrow("Completion");
  });

});
it("producer confirmation is tied to a delivery version, even if task status is unchanged", async () => {
  const { s, db } = await setup();
  const t = s.createTask({
    title: "交付版本",
    objective: "仅文本",
    owner: "developer",
    acceptance: "producer",
  });
  const current = s.updateTask(
    t.id,
    {
      status: "completed",
      summary: "fixture",
      evidence: ["fixture"],
      delivery: reviewDelivery,
    },
    "developer",
  );
  const input = {
    action: "approve",
    comment: "仅文案范围",
    clientRequestId: crypto.randomUUID(),
    expectedUpdatedAt: current.updatedAt,
    expectedStatus: current.status,
    bindingRevision: s.agent("developer").revision,
    expectedDeliveryId: "wrong-version",
  };
  expect(() => s.taskAction(t.id, input)).toThrow("交付版本");
  expect(db.get("tasks", t.id)?.status).toBe("awaiting_acceptance");
  expect(db.all("receipts")).toHaveLength(0);
});
it("history reconciliation preserves terminal message timestamps and run observations when facts are unchanged", async () => {
  const { s, db } = await setup();
  const m = s.submit({ recipient: "developer", content: "replay stability" });
  await pause(300);
  await s.reconcile("developer");
  const beforeMessage = JSON.stringify(db.get("messages", m.id)),
    beforeRuns = JSON.stringify(db.all("runs"));
  await s.reconcile("developer");
  expect(JSON.stringify(db.get("messages", m.id))).toBe(beforeMessage);
  expect(JSON.stringify(db.all("runs"))).toBe(beforeRuns);
});
it('Unity environment grant belongs to producer and cannot be self-granted by a lead',async()=>{
 const {s}=await setup();const data={title:'授权实验',objective:'限定验证',owner:'developer',executor:'dsh',purpose:'product',useUnity:true};
 expect(()=>s.createTask(data,'developer')).toThrow('制作人');expect(()=>s.createTask({...data,purpose:'unknown'})).toThrow('制作人');expect(()=>s.createTask({...data,owner:'planner'})).toThrow('制作人');expect(s.createTask(data)).toMatchObject({useUnity:true});expect(s.createTask({title:'普通',objective:'分析',owner:'developer'})).not.toHaveProperty('useUnity');
});

