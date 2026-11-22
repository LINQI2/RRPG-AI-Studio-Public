import {workPartition} from "./current-work.js";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  statusNames,
  stateName,
  errorSummary,
  Raw,
  NativeTurn,
  TechnicalItem,
  MessageBody,
  eventName,
  inMessageView,
  ReadableText,
  itemSummary,
} from "./presentation.js";
import { TaskActionPanel, taskActionNames } from "./task-action.js";
import { InputPanel, type InputSpec } from "./input-panel.js";
import { DshActivity } from "./dsh-activity.js";
import { taskProgress } from "./task-progress.js";
import { TaskTree } from "./task-tree.js";
import { AgentStatus } from "./agent-status.js";
import { RecentOutcomes } from "./recent-outcomes.js";
import { ExecutionHistory } from "./execution-history.js";
import { NotificationCenter } from "./notifications.js";
import {RuleCenter} from './rule-center.js';
import { decisionAudience } from "../shared/decision-routing.js";
import {
  TaskBrief,
  TaskOutcome,
  TaskTimeline,
  Progress,
  taskPurpose,
  readyForProducer,
} from "./product-views.js";
type R = Record<string, any>;
// Versioned reset removes old drafts, entry and task selections on this origin.
function clearStudioStorage(){for(const key of Object.keys(localStorage))if(key.startsWith("studio-")||key.startsWith("rrpg-studio"))localStorage.removeItem(key);sessionStorage.clear();}
if(localStorage.getItem("studio-storage-version")!=="20261022-clean"){clearStudioStorage();localStorage.setItem("studio-storage-version","20261022-clean");}

let csrf = "";
async function api(
  url: string,
  body?: any,
  method = "POST",
  retried = false,
): Promise<any> {
  const r = await fetch("/api/" + url, {
    ...(url.endsWith("/actions") ? { signal: AbortSignal.timeout(20000) } : {}),
    method: body === undefined ? "GET" : method,
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Studio-CSRF": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const d = await r.json();
  if (
    (r.status === 401 ||
      (r.status === 403 && d.error === "CSRF token invalid")) &&
    url !== "session" &&
    !retried
  ) {
    const session = await api("session");
    csrf = session.csrf;
    return api(url, body, method, true);
  }
  if (!r.ok)
    throw Object.assign(Error(d.error || r.statusText), { status: r.status });
  if (url === "session") csrf = d.csrf;
  if (url === "snapshot" && d.dataEpoch) {
    const prior=localStorage.getItem("studio-data-epoch");
    if(prior && prior!==d.dataEpoch){clearStudioStorage();localStorage.setItem("studio-data-epoch",d.dataEpoch);location.reload();}
    else localStorage.setItem("studio-data-epoch",d.dataEpoch);
  }
  return d;
}
const names: R = {
  planner: "主策划",
  developer: "主开发",
  producer: "制作人",
  system: "系统",
  "dsh-executor": "DSH 执行层",
  "dsh-supervisor": "DSH进展检查",
};
const labels: R = {
  ...statusNames,
  idle: "空闲",
  active: "执行中",
  unbound: "未绑定",
  unknown: "状态未知",
  disconnected: "已断线",
  dispatching: "派发中",
  recorded: "Studio 待派发",
  accepted: "已接受",
  in_progress: "执行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  notification: "仅通知",
  observed_reply: "原生回复",
  legacy: "历史原型记录",
  pending: "待处理",
  running: "执行中",
  blocked: "阻塞",
  awaiting_acceptance: "待验收",
  cancelled: "已取消",
  error: "异常",
  creating: "创建中",
  creation_unknown: "创建结果未知",
};
const time = (s: any) =>
  s
    ? new Date(typeof s === "number" ? s * 1000 : s).toLocaleString("zh-CN", {
        hour12: false,
      })
    : "—";
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value}>
      {labels[value] || stateName(value)}
    </span>
  );
}
function App() {
  const [s, setS] = useState<R | null>(null),
    [page, setPage] = useState(() => {
      try {
        const p = localStorage.getItem("studio-entry");
        return ["dashboard", "collaboration", "tasks", "settings"].includes(
          p || "",
        )
          ? p!
          : "dashboard";
      } catch {
        return "dashboard";
      }
    }),
    [role, setRole] = useState("planner"),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [history, setHistory] = useState<R[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | undefined>(),
    [live, setLive] = useState<R>({});
  const [draft, setDraft] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("studio-drafts") || "{}");
    } catch {
      return {};
    }
  });
  const [taskOperation, setTaskOperation] = useState<{
    task: R;
    action: string;
  } | null>(null);
  const [inputPanel, setInputPanel] = useState<InputSpec | null>(null);
  const [messageLimit, setMessageLimit] = useState(80),
    [taskLimit, setTaskLimit] = useState(30);
  const [ownerFilter, setOwnerFilter] = useState(""),
    [stateFilter, setStateFilter] = useState("");
  const [progress, setProgress] = useState<R[]>([]),
    [progressNext, setProgressNext] = useState<number | null>(null),
    [covered, setCovered] = useState(0);
  const openInput = (spec: InputSpec) => setInputPanel(spec);
  const openArtifact = async (file: string) => {
    try {
      const result = await api("artifact?path=" + encodeURIComponent(file));
      openInput({
        title: "项目文档",
        description: "只读文本预览，不运行文件，不扩大执行范围。",
        fields: [],
        initialResult: result,
        submit: async () => result,
      });
    } catch (e) {
      setError(String(e));
    }
  };
  const [showNative, setShowNative] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    if (followLatest.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [s?.messages.length, role]);
  const [task, setTask] = useState(""),
    [reply, setReply] = useState("");
  const refreshTimer = useRef<any>(null);
  const source = useRef<EventSource | null>(null);
  const loadProgress = async (after: number, append = false) => {
    const p = await api("progress?after=" + after);
    setProgress((v) => (append ? [...v, ...p.rows] : p.rows));
    setProgressNext(p.next);
    setCovered(p.coveredThrough);
  };
  const refresh = async () => {
    const snap = await api("snapshot");
    setS(snap);
    await loadProgress(snap.viewCursor);
    setSyncError("");
  };
  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        await api("session");
        const snap = await api("snapshot");
        if (stopped) return;
        setS(snap);
        await loadProgress(snap.viewCursor);
        setSyncError("");
        const es = new EventSource("/api/events?after=" + snap.seq);
        source.current = es;
        es.addEventListener("activity", () => {
          clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(
            () => void refresh().catch((e) => setSyncError(String(e))),
            100,
          );
        });
        es.addEventListener("delta", (e: any) => {
          const d = JSON.parse(e.data),
            p = d.params || {};
          setLive((v) => ({
            ...v,
            [`${p.threadId}:${p.turnId}:${p.itemId}`]:
              (v[`${p.threadId}:${p.turnId}:${p.itemId}`] || "") +
              (p.delta || ""),
          }));
        });
        es.onerror = () => {
          es.close();
          if (stopped) return;
          setNotice("事件流重连中；正在核对后台状态");
          reconnectTimer = setTimeout(() => void connect(), 1500);
        };
        es.onopen = () => setNotice("");
      } catch (e) {
        if (!stopped) {
          setNotice("后台暂不可达，保留草稿并等待重连");
          reconnectTimer = setTimeout(() => void connect(), 3000);
        }
      }
    };
    void connect();
    return () => {
      stopped = true;
      source.current?.close();
      clearTimeout(refreshTimer.current);
      clearTimeout(reconnectTimer);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("studio-drafts", JSON.stringify(draft));
    } catch {
      setNotice("浏览器未保存草稿；当前页面内容仍保留，关闭前请另行保存。");
    }
  }, [draft]);
  const actionLock = useRef(false);
  async function act(fn: () => Promise<any>, success = "操作已记录") {
    if (actionLock.current) return null;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (result?.errors?.length) {
        setNotice(
          `已处理 ${result.imported || 0} 项，另有 ${result.errors.length} 项失败。`,
        );
        setError(
          "交接扫描部分失败：" +
            result.errors.map((e: R) => `${e.file}：${e.error}`).join("；"),
        );
      } else setNotice(result?.path ? `${success}：${result.path}` : success);
      await refresh();
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
      actionLock.current = false;
    }
  }
  const navigate = (p: string, r?: string) => {
    setPage(p);
    try {
      localStorage.setItem("studio-entry", p);
    } catch {
      setNotice("浏览器未允许保存入口，下次将显示工作台。");
    }
    setQuery("");
    setShowNative(false);
    setTaskLimit(30);
    setMessageLimit(80);
    followLatest.current = true;
    if (r) {
      setRole(r);
      setHistory([]);
      setHistoryCursor(undefined);
    }
    setError("");
  };
  if (!s)
    return (
      <main className="loading">
        RRPG AI Studio · 正在读取本地工作台…{error && <p>{error}</p>}
      </main>
    );
  const agent = s.agents.find((a: R) => a.id === role);
  const recent = s.events.filter((e: R) => e.seq > s.viewCursor);
  const filteredTasks = s.tasks.filter(
    (t: R) =>
      (!ownerFilter || t.owner === ownerFilter) &&
      (!stateFilter || t.status === stateFilter) &&
      (!query ||
        [t.title, t.objective, t.summary, names[t.owner], labels[t.status]]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const selectedTask = s.tasks.find((t: R) => t.id === task);
  const visibleMessages = s.messages.filter(
    (m: R) =>
      inMessageView(m, role) &&
      (!query || String(m.content).toLowerCase().includes(query.toLowerCase())),
  );
  const recentTools = s.items
    .filter(
      (i: R) =>
        i.threadId === agent?.threadId &&
        !["agentMessage", "userMessage", "reasoning"].includes(i.type),
    )
    .slice(-8);
  const toolAttention = recentTools.filter((i: R) =>
    /失败|错误|未知|待核对|未提供|未识别/.test(
      itemSummary(i).result + itemSummary(i).action,
    ),
  ).length;
  const send = () =>
    act(async () => {
      const text = draft[role]?.text || "";
      const key = draft[role]?.key || crypto.randomUUID();
      setDraft((d: R) => ({ ...d, [role]: { text, key } }));
      await api("messages", {
        recipient: role,
        content: text,
        clientRequestId: key,
        bindingRevision: agent.revision,
        ...(task ? { taskId: task } : {}),
        ...(reply ? { replyTo: reply } : {}),
      });
      setDraft((d: R) => ({
        ...d,
        [role]: { text: "", key: crypto.randomUUID() },
      }));
      setReply("");
    }, "消息已持久记录，执行状态见时间线");
  function taskActions(t: R) {
    const progress = taskProgress(t, s!);
    return (
      <div className="actions">
        <button disabled={busy} onClick={()=>openInput({
          title:"调整任务归属",description:`任务：${t.title}。只改变父子组织关系，不启动任务、不改变负责人、验收或执行权限。禁止成环；请依据实际工作包关系填写。`,
          fields:[{name:"parentTaskId",label:"上级任务",value:t.parentTaskId||"__root__",options:[{value:"__root__",label:"无上级，作为顶层任务"},...s!.tasks.filter((p:R)=>p.id!==t.id).map((p:R)=>({value:p.id,label:p.title}))]},{name:"reason",label:"归属依据"}],
          submit:async(v)=>{const result=await api(`tasks/${t.id}/parent`,{parentTaskId:v.parentTaskId==="__root__"?null:v.parentTaskId,reason:v.reason,expectedUpdatedAt:t.updatedAt});await refresh();return result;}
        })}>调整任务归属</button>
        <button
          disabled={busy}
          onClick={() => {
            setTask(t.id);
            navigate("collaboration", t.owner);
          }}
        >
          进入负责人会话
        </button>
        {t.executor === "dsh" &&
          !["completed", "cancelled"].includes(t.status) && (
            <button
              disabled={
                busy || progress.blockedSend ||
                (s!.executions || []).some(
                  (j: R) =>
                    j.taskId === t.id &&
                    [
                      "preparing",
                      "dispatching",
                      "running",
                      "cancelling",
                      "unknown",
                      "blocked",
                    ].includes(j.status),
                )
              }
              onClick={() => {
                const key = crypto.randomUUID();
                setInputPanel({
                  title: "提交 DSH 执行",
                  description: `任务：${t.title}；负责人：${names[t.owner]}。将使用已授权 DeepSeek 账户，在新的本任务独立授权目录执行。全局 Shell 关闭；选择本次目录 Shell 时仅为该任务准备临时权限，执行停止后回收。不会写入正式 RRPG。模型执行结束不代表专业核验或制作人验收通过。`,
                  fields: [
                    {
                      name: "instruction",
                      label: "执行目标、范围与验证要求",
                      value: t.objective,
                    },
                    ...(s?.dsh?.managedShell
                      ? [
                          {
                            name: "shellMode",
                            label: "本次执行方式",
                            value: "disabled",
                            options: [
                              {
                                value: "disabled",
                                label: "文件工具（不运行 Shell）",
                              },
                              {
                                value: "managed",
                                label: "本任务原生 Shell（临时目录授权）",
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                  submit: async (values) => {
                    const r = await api(`tasks/${t.id}/executions`, {
                      instruction: values.instruction,
                      ...(values.shellMode === "managed"
                        ? { shellMode: "managed" }
                        : {}),
                      clientRequestId: key,
                    });
                    await refresh();
                    return r;
                  },
                });
              }}
            >
              提交 DSH 执行
            </button>
          )}
        {(
          (t.executor === "dsh"
            ? []
            : t.status === "pending"
              ? [
                  t.messages?.length ||
                  t.runs?.length ||
                  t.revisionPhase ||
                  t.actionHistory?.some((a: R) =>
                    ["start", "continue", "resend"].includes(a.action),
                  )
                    ? "continue"
                    : "start",
                ]
              : ["running", "blocked", "error"].includes(t.status)
                ? ["continue"]
                : ["completed", "cancelled"].includes(t.status)
                  ? ["resend"]
                  : []) as string[]
        ).map((action) => (
          <button
            key={action}
            disabled={busy || progress.blockedSend}
            title={progress.blockedSend ? progress.status + "；请勿重复派发，可进入负责人会话查看。" : undefined}
            onClick={() => setTaskOperation({ task: t, action })}
          >
            {taskActionNames[action]}
          </button>
        ))}
        {t.status === "awaiting_acceptance" &&
          ["approve", "revise", "discuss"].map((action) => (
            <button
              key={action}
              disabled={
                busy ||
                (action === "approve" &&
                  !readyForProducer(
                    t,
                    (s!.deliveries || [])
                      .filter((d: R) => d.taskId === t.id)
                      .at(-1),
                  ))
              }
              onClick={() => setTaskOperation({ task: t, action })}
            >
              {taskActionNames[action]}
            </button>
          ))}
        <TaskTimeline task={t} snapshot={s!} />
      </div>
    );
  }
  return (
    <div className="shell">
      {inputPanel && (
        <InputPanel spec={inputPanel} onClose={() => setInputPanel(null)} />
      )}
      {taskOperation && (
        <TaskActionPanel
          task={taskOperation.task}
          action={taskOperation.action}
          snapshot={s}
          onClose={() => setTaskOperation(null)}
          onChat={() => {
            setTask(taskOperation.task.id);
            navigate("collaboration", taskOperation.task.owner);
            setTaskOperation(null);
          }}
          submit={async (body) => {
            const result = await api(
              `tasks/${taskOperation.task.id}/actions`,
              body,
            );
            void refresh().catch((e) => setSyncError(String(e)));
            return result;
          }}
        />
      )}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            RRPG<span>AI STUDIO</span>
          </div>
        </div>
        <div className="workspace-label">本地研发工作台</div>
        <nav>
          {[
            ["dashboard", "◈", "工作台"],
            ["collaboration", "↗", "会话"],
            ["tasks", "▤", "任务"],
            ["settings", "⚙", "设置"],
          ].map(([id, icon, title]) => (
            <button
              key={id}
              aria-label={title}
              className={page === id ? "nav active" : "nav"}
              onClick={() => navigate(id)}
            >
              <i aria-hidden="true">{icon}</i>
              <span>{title}</span>
              {id === "tasks" && (
                <b>
                  {workPartition(s).current.length}
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={"dot " + (s.connected ? "good" : "bad")} />
          {s.connected ? "后台已连接" : "后台未连接"}
          <small>
            {s.authenticated ? "CLI 认证可用" : "CLI 尚未认证"}
            <br />
            Codex 只读 · DSH 按任务授权
          </small>
          <div className="version">双长期负责人 · 研发协作工作台</div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            RRPG / Studio /{" "}
            <strong>
              {
                {
                  dashboard: "工作台",
                  collaboration: "会话",
                  tasks: "任务",
                  settings: "设置",
                }[page]
              }
            </strong>
          </div>
          <span className="local-tag">本地运行 · 游戏工程尚未正式接入</span>
          <NotificationCenter snapshot={s} onOpen={(n)=>{
            if(n.kind==="reply"){if(n.taskId)setTask(n.taskId);navigate("collaboration",n.owner||"developer");}
            else if(n.kind==="acceptance"||n.kind==="delivery"){setQuery("");setOwnerFilter("");setStateFilter("");setTaskLimit(s.tasks.length+30);if(n.taskId)setTask(n.taskId);navigate("tasks");}
            else {navigate("dashboard");setTimeout(()=>document.getElementById("producer-attention")?.scrollIntoView({behavior:"smooth",block:"start"}),0);}
          }}/>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">制作人工作空间</div>
              <h1>
                {
                  {
                    dashboard: "研发，正在发生。",
                    collaboration: "把问题交给对的人。",
                    tasks: "从目标到可验收的成果。",
                    settings: "连接、恢复与边界。",
                  }[page]
                }
              </h1>
              <p>
                {
                  {
                    dashboard: "两位长期负责人，一份可追溯的研发现场。",
                    collaboration:
                      "直接和负责人沟通。原生会话历史与技术证据可按需查看。",
                    tasks: "任务保留上下文，修改继续原任务。",
                    settings: "Studio 统一派发，执行权限保持在明确授权的工作范围。",
                  }[page]
                }
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void refresh()
                  .then(() => setNotice("已刷新真实状态"))
                  .catch((e) => setSyncError(String(e)))
              }
            >
              ↻ 刷新
            </button>
          </div>
          {syncError && (
            <div className="notice" role="status">
              工作台同步暂未完成，保留现有记录并等待重连；不会自动重发任务。
              <Raw label="查看同步错误原文" value={syncError} />
            </div>
          )}
          {error && (
            <div role="alert" className="alert error">
              {errorSummary(error)}
              <Raw label="查看原始错误" value={error} />
            </div>
          )}
          {s.dsh?.maintenance && (
            <div className="alert notice" role="status">工作台维护中：已暂停自动派发，现有任务、对话和成果保留。维护验收后再恢复研发。</div>
          )}
          {s.environment?.kind === "simulated" && (
            <div className="alert notice">
              协议模拟验收环境 · 本页回复与执行均为 fixture，不代表真实 Codex
              通过。
            </div>
          )}
          {busy && <p role="status">正在提交并核对实际状态…</p>}
          {notice && (
            <div role="status" className="alert notice">
              {notice}
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {page === "dashboard" && (
            <>
              <section className="card">
                <h2>当前研发目标</h2>
                <p>
                  {s.projectGoal?.objective ||
                    "尚未单独登记当前阶段目标；工程配置请看设置，已有交付请看最近成果。"}
                </p>
                <p>
                  下一步：
                  {s.projectGoal?.next ||
                    "尚未登记；由负责人依据已确认目标整理，不从日志推断。"}
                </p>
                <button
                  onClick={() =>
                    openInput({
                      title: "登记当前阶段目标",
                      description:
                        "保存制作人已确认的目标与下一步，不启动原生 Goal 或模型执行。",
                      fields: [
                        {
                          name: "objective",
                          label: "阶段目标",
                          value: s.projectGoal?.objective,
                        },
                        {
                          name: "next",
                          label: "下一步",
                          value: s.projectGoal?.next,
                        },
                      ],
                      submit: async (v) => {
                        const r = await api("project-goal", v);
                        await refresh();
                        return r;
                      },
                    })
                  }
                >
                  整理阶段目标
                </button>
              </section>
              <div className="agent-grid">
                {s.agents.map((a: R) => {
                  const work = workPartition(s).current.filter(
                    (t: R) =>
                      t.owner === a.id &&
                      (!t.parentTaskId || !s.tasks.some((p:R)=>p.id===t.parentTaskId&&p.owner===a.id)) &&
                      !["completed", "cancelled"].includes(t.status),
                  );
                  return (
                    <article className="card" key={a.id}>
                      <h2>{names[a.id]}</h2>
                      <p>
                        {work.length
                          ? work.map((t: R) => t.title).join("；")
                          : "当前没有待推进的研发目标；已交付内容见最近成果。"}
                      </p>
                      <p>
                        专业职责：
                        {a.id === "planner"
                          ? "玩法、规则、数值与设计质量"
                          : "技术实现、编译、回归与故障修复"}
                      </p>
                      <button onClick={() => navigate("collaboration", a.id)}>
                        进入聊天 ↗
                      </button>
                      <AgentStatus agent={a} snapshot={s} />
                    </article>
                  );
                })}
              </div>
              <section className="card">
                <h2>风险与阻塞</h2>
                <p>
                  执行能力以当前项目授权与实际验证为准；具体限制见设置及交付记录。
                </p>
                {workPartition(s).current
                  .filter(
                    (t: R) =>
                      true &&
                      ["blocked", "error", "unknown"].includes(t.status),
                  )
                  .map((t: R) => (
                    <p key={t.id}>
                      {t.title}：{stateName(t.status)}。由{names[t.owner]}
                      核对，未自动请求制作人批准。
                    </p>
                  ))}
              </section>
              <RecentOutcomes snapshot={s} open={openArtifact} onTask={(t:R)=>{
                setQuery("");setOwnerFilter("");setStateFilter("");setTaskLimit(Math.max(30,s.tasks.findIndex((x:R)=>x.id===t.id)+1));setTask(t.id);navigate("tasks");
              }}/>
              <div className="dashboard-grid">
                <section className="card" id="producer-attention">
                  <div className="section-heading">
                    <h2>需要制作人关注</h2>
                    <span>决策与验收</span>
                  </div>
                  <p>这里只处理产品取舍、指定验收、新权限或重大风险。普通技术排查由负责人推进，维护求助收在下方。</p>
                  {s.decisions
                    .filter((d: R) => d.status === "open" && decisionAudience(d)==="producer")
                    .map((d: R) => (
                      <div className="decision" key={d.id}>
                        <Badge value="blocked" />
                        <h3>{d.question}</h3>
                        <details><summary>查看问题依据与备选方案</summary><p>{d.facts}</p>
                        <ul>
                          {d.options.map((o: string) => (
                            <li key={o}>{o}</li>
                          ))}
                        </ul>
                        </details>
                        <button
                          onClick={() => {
                            openInput({
                              title: "回答产品判断事项",
                              description:
                                d.question +
                                "；答复回到原负责人上下文，不授予额外权限。",
                              fields: [{ name: "answer", label: "制作人答复" }],
                              submit: async (v) => {
                                const r = await api(
                                  `decisions/${d.id}/answer`,
                                  v,
                                );
                                await refresh();
                                return r;
                              },
                            });
                          }}
                        >
                          在原会话回答 ↗
                        </button>
                      </div>
                    ))}
                  {s.requests
                    .filter((r: R) => r.status === "open")
                    .map((r: R) => (
                      <div className="decision" key={r.id}>
                        <h3>{names[r.owner]}请求答复</h3>
                        {(r.questions||[]).map((q:R)=><p key={q.id}>{q.question}</p>)}
                        <button
                          onClick={() => {
                            openInput({
                              title: "回答负责人问题",
                              description:
                                "回答后提交到原生请求；失效请求会返回错误，不自动重建。",
                              fields: (r.questions || []).map((q: R) => ({
                                name: q.id,
                                label: q.question,
                              })),
                              submit: async (v) => {
                                const answers = Object.fromEntries(
                                  Object.entries(v).map(([k, text]) => [
                                    k,
                                    { answers: [text] },
                                  ]),
                                );
                                const result = await api(
                                  `requests/${encodeURIComponent(r.id)}/answer`,
                                  { answers },
                                );
                                await refresh();
                                return result;
                              },
                            });
                          }}
                        >
                          回答全部问题
                        </button>
                      </div>
                    ))}
                  {s.tasks
                    .filter(
                      (t: R) =>
                        t.status === "awaiting_acceptance" &&
                        true &&
                        readyForProducer(
                          t,
                          (s.deliveries || [])
                            .filter((d: R) => d.taskId === t.id)
                            .at(-1),
                        ),
                    )
                    .map((t: R) => (
                      <div className="decision" key={t.id}>
                        <h3>{t.title}</h3>
                        <TaskBrief task={t} snapshot={s} />
                        <details>
                          <summary>阅读完整成果、验证与反馈</summary>
                          <TaskOutcome
                            task={t}
                            snapshot={s}
                            open={openArtifact}
                          />
                        </details>
                        <Raw
                          label="查看交付证据"
                          value={t.evidence.join("\n")}
                        />
                        {taskActions(t)}
                      </div>
                    ))}
                  {!s.decisions.some((d: R) => d.status === "open" && decisionAudience(d)==="producer") &&
                    !s.requests.some((r: R) => r.status === "open") &&
                    !s.tasks.some(
                      (t: R) =>
                        true &&
                        readyForProducer(
                          t,
                          (s.deliveries || [])
                            .filter((d: R) => d.taskId === t.id)
                            .at(-1),
                        ),
                    ) && (
                      <Empty
                        title={s.decisions.some((d:R)=>d.status==="open"&&decisionAudience(d)==="unclassified")?"暂无已明确的产品决定；有历史请求待核对归属":"当前没有待决定或待验收事项"}
                        text="产品决定和指定验收在此处理；技术协助及待归类记录保留在下方。"
                      />
                    )}
                  <details className="technical-assistance">
                    <summary>技术协助与维护记录（{s.decisions.filter((d:R)=>d.status==="open"&&decisionAudience(d)==="technical").length}）</summary>
                    <p>由主开发或维护端处理，不是要求制作人批准技术细节。历史请求未关闭，不代表问题仍未解决；原始证据继续保留。</p>
                    {s.decisions.filter((d:R)=>d.status==="open"&&decisionAudience(d)==="technical").map((d:R)=><article className="decision" key={d.id}>
                      <h3>{names[d.owner]}的技术协助记录</h3>
                      <details><summary>查看求助内容与技术依据</summary><h4>{d.question}</h4><p className="message-content">{d.facts}</p><ul>{d.options.map((o:string,i:number)=><li key={i}>{o}</li>)}</ul></details>
                      <button onClick={()=>{if(d.taskId)setTask(d.taskId);navigate("collaboration",d.owner);}}>进入负责人会话</button>
                    </article>)}
                  </details>
                  {s.decisions.some((d:R)=>d.status==="open"&&decisionAudience(d)==="unclassified")&&<details>
                    <summary>待核对处理责任的历史请求（{s.decisions.filter((d:R)=>d.status==="open"&&decisionAudience(d)==="unclassified").length}）</summary>
                    <p>旧记录没有注明产品决定还是技术协助，需要维护端核对；没有自动批准、关闭或按关键词猜测。</p>
                    {s.decisions.filter((d:R)=>d.status==="open"&&decisionAudience(d)==="unclassified").map((d:R)=><details key={d.id}><summary>{names[d.owner]}的历史请求</summary><p>{d.question}</p><p>{d.facts}</p></details>)}
                  </details>}
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h2>研发进展</h2>
                    <button
                      onClick={() =>
                        void act(
                          () => api("view-cursor", { seq: covered }),
                          "已标记为看过",
                        )
                      }
                    >
                      标记看过
                    </button>
                  </div>
                  <p>
                    仅覆盖已加载的业务变化；标记看过不会批准成果。同步日志不生成研发通知。
                  </p>
                  <Progress
                    rows={progress}
                    snapshot={s}
                    loadMore={
                      progressNext !== null
                        ? () => void loadProgress(progressNext, true)
                        : undefined
                    }
                  />
                </section>
              </div>
            </>
          )}
          {page === "collaboration" && (
            <>
              <div className="tabs">
                {["planner", "developer", "peers"].map((r) => (
                  <button
                    key={r}
                    className={role === r ? "selected" : ""}
                    onClick={() => {
                      setRole(r);
                      setQuery("");
                      setHistoryNotice("");
                      followLatest.current = true;
                      setHistory([]);
                      setHistoryCursor(undefined);
                      setTask("");
                      setReply("");
                    }}
                  >
                    {r === "peers" ? "主策划 ↔ 主开发" : `你 ↔ ${names[r]}`}
                  </button>
                ))}
              </div>
              <div className="chat-toolbar">
                <span>聊天为主 · 工具与原始执行详情默认折叠</span>
                <button onClick={() => setShowNative((v) => !v)}>
                  {showNative ? "收起原生会话历史" : "查看原生会话历史"}
                </button>
              </div>
              <div
                className={
                  "collaboration-grid" + (showNative ? "" : " chat-focused")
                }
              >
                <section className="card conversation chat-panel">
                  <div className="section-heading">
                    <h2>
                      {role === "peers"
                        ? "负责人通信 · 消息筛选"
                        : names[role] + " · 聊天"}
                    </h2>
                    {agent && <Badge value={agent.status} />}
                  </div>
                  <input
                    aria-label="搜索消息"
                    placeholder="搜索消息内容 / ID"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <p className="muted">
                    这里按负责人筛选 Studio 消息；完整原生 Thread
                    历史请使用上方入口。历史英文内容保留原文。 当前显示{" "}
                    {visibleMessages.length} 条，其他视图或搜索条件隐藏{" "}
                    {s.messages.length - visibleMessages.length}{" "}
                    条；筛选不会删除记录。
                  </p>
                  <div
                    className="messages"
                    ref={messagesRef}
                    onScroll={() => {
                      const el = messagesRef.current;
                      if (el)
                        followLatest.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight <
                          100;
                    }}
                  >
                    {visibleMessages.length > messageLimit && (
                      <button onClick={() => setMessageLimit((v) => v + 80)}>
                        加载更早消息（还有{" "}
                        {visibleMessages.length - messageLimit} 条）
                      </button>
                    )}
                    {visibleMessages.slice(-messageLimit).map((m: R) => (
                      <article
                        key={m.id}
                        className={
                          "message sender-" +
                          m.sender +
                          (m.sender === "producer" ? " mine" : "")
                        }
                      >
                        <div className="message-meta">
                          <b>
                            {names[m.sender] || m.sender} → {names[m.recipient]}
                          </b>
                          <span>{time(m.createdAt)}</span>
                          {m.nativeItemId ? (
                            <span className="badge">
                              {m.recipient === "producer"
                                ? "负责人原生答复"
                                : "原生答复投影 · 未证明对方接收"}
                            </span>
                          ) : (
                            <Badge value={m.delivery} />
                          )}
                        </div>
                        <MessageBody message={m} />
                        <details className="chat-details">
                          <summary>消息详情</summary>
                          <div className="message-id">
                            消息编号：{m.id}
                            {m.replyTo && " · 回复消息：" + m.replyTo}
                            {m.taskId && " · 任务编号：" + m.taskId}
                          </div>
                        </details>
                        {m.error && (
                          <div className="error-text">
                            {errorSummary(m.error)}
                            <Raw label="查看执行错误原文" value={m.error} />
                          </div>
                        )}
                        {m.sender === "producer" &&
                          m.delivery === "recorded" && (
                            <button
                              onClick={() =>
                                void act(
                                  () => api(`messages/${m.id}/cancel`, {}),
                                  "已取消尚未派发的消息",
                                )
                              }
                            >
                              取消待派发
                            </button>
                          )}
                        {role !== "peers" && m.sender !== "producer" && (
                          <button onClick={() => setReply(m.id)}>
                            关联回复
                          </button>
                        )}
                      </article>
                    ))}
                    {visibleMessages.length === 0 && (
                      <Empty
                        title="当前筛选下暂无消息"
                        text="可调整搜索或切换负责人；原始记录仍然保留。"
                      />
                    )}
                  </div>
                  <button
                    className="jump-latest"
                    onClick={() => {
                      followLatest.current = true;
                      const el = messagesRef.current;
                      if (el) el.scrollTop = el.scrollHeight;
                    }}
                  >
                    回到最新消息
                  </button>
                  {role !== "peers" && (
                    <details className="chat-technical">
                      <summary>
                        最近工具与执行记录（按需展开） · 最近{" "}
                        {recentTools.length} 项 · 异常或待核对 {toolAttention}{" "}
                        项
                      </summary>
                      {recentTools.map((i: R) => (
                        <TechnicalItem key={i.id} item={i} />
                      ))}
                    </details>
                  )}
                  {role !== "peers" && (
                    <div className="composer">
                      {selectedTask && (
                        <p>
                          关联任务：{selectedTask.title} ·{" "}
                          {labels[selectedTask.status] ||
                            stateName(selectedTask.status)}
                        </p>
                      )}
                      <div className="composer-options">
                        <select
                          aria-label="关联任务"
                          value={task}
                          onChange={(e) => setTask(e.target.value)}
                        >
                          <option value="">普通对话 · 不创建任务</option>
                          {s.tasks
                            .filter((t: R) => t.owner === role && true)
                            .map((t: R) => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                        </select>
                        {reply && (
                          <button onClick={() => setReply("")}>
                            清除关联回复
                          </button>
                        )}
                      </div>
                      <textarea
                        aria-label="给负责人发消息"
                        placeholder={`给${names[role]}发送消息…`}
                        value={draft[role]?.text || ""}
                        onChange={(e) =>
                          setDraft((d: R) => ({
                            ...d,
                            [role]: {
                              text: e.target.value,
                              key: crypto.randomUUID(),
                            },
                          }))
                        }
                      />
                      <div className="composer-foot">
                        <small>
                          {s.authenticated
                            ? "忙碌时进入 Studio 待派发队列"
                            : "未认证时可保留草稿；不会自动调用模型"}
                        </small>
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            !agent?.threadId ||
                            !draft[role]?.text?.trim()
                          }
                          onClick={() => void send()}
                        >
                          记录并发送 ↗
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                {showNative && (
                  <aside className="card execution">
                    <div className="section-heading">
                      <h2>完整原生 Thread 历史</h2>
                      <span>原始信息可展开</span>
                    </div>
                    {role === "peers" ? (
                      <p>
                        此视图没有第三个
                        Thread，仅筛选两位负责人的通信。请选择负责人查看完整原生会话历史。
                      </p>
                    ) : (
                      <>
                        <p className="mono">
                          {agent.threadId || "未绑定 Thread"}
                        </p>
                        <div className="actions">
                          <button
                            disabled={busy || !agent.threadId}
                            onClick={() =>
                              void act(async () => {
                                const d = await api(`agents/${role}/history`);
                                setHistory(d.data);
                                setHistoryCursor(d.nextCursor);
                                setHistoryNotice(
                                  d.limitation ||
                                    d.toolEvidenceLimitation ||
                                    "",
                                );
                              }, "原生历史已读取")
                            }
                          >
                            读取原生历史
                          </button>
                          <button
                            disabled={busy || !agent.threadId}
                            onClick={() =>
                              void act(() =>
                                api(`agents/${role}/reconcile`, {}),
                              )
                            }
                          >
                            核对与恢复
                          </button>
                        </div>
                        {agent.activeTurnId && (
                          <div className="actions">
                            <button
                              onClick={() => {
                                openInput({
                                  title: "调整执行方向",
                                  description:
                                    "立即补充当前执行轮次；这与普通排队消息不同。执行已结束时将拒绝，不自动重发。",
                                  fields: [
                                    {
                                      name: "content",
                                      label: "当前需要调整的内容",
                                    },
                                  ],
                                  submit: (v) =>
                                    api(`agents/${role}/steer`, {
                                      turnId: agent.activeTurnId,
                                      ...v,
                                    }),
                                });
                              }}
                            >
                              调整执行方向
                            </button>
                            <button
                              className="danger"
                              onClick={() =>
                                void act(
                                  () =>
                                    api(`agents/${role}/interrupt`, {
                                      turnId: agent.activeTurnId,
                                    }),
                                  "中断请求已发送，等待原生终态",
                                )
                              }
                            >
                              中断执行
                            </button>
                          </div>
                        )}
                        <p className="muted">
                          原生控制接口的真实验证状态见设置。中断不会撤销已发生的工具副作用。
                        </p>
                        {historyNotice && (
                          <div className="alert notice">
                            部分原生记录读取受限，以下为实际可读内容。
                            <Raw
                              label="查看读取限制原文"
                              value={historyNotice}
                            />
                          </div>
                        )}
                        <p className="muted">
                          按页读取原始
                          Thread，包含输入、回复和原生工具记录；未识别类型保留原标识，不推断成功。
                        </p>
                        {history.map((t) => (
                          <NativeTurn key={t.id} turn={t} />
                        ))}
                        {historyCursor && (
                          <button
                            onClick={() =>
                              void act(async () => {
                                const d = await api(
                                  `agents/${role}/history?cursor=${encodeURIComponent(historyCursor)}`,
                                );
                                setHistory((v) => [...v, ...d.data]);
                                setHistoryCursor(d.nextCursor);
                              }, "已加载更早历史")
                            }
                          >
                            加载更多
                          </button>
                        )}
                        {!history.length &&
                          s.items
                            .filter((i: R) => i.threadId === agent.threadId)
                            .slice(-20)
                            .map((i: R) => (
                              <TechnicalItem key={i.id} item={i} />
                            ))}
                        {Object.entries(live)
                          .filter(([k]) => k.startsWith(agent.threadId + ":"))
                          .map(([k, v]) => (
                            <details key={k}>
                              <summary>实时输出片段（最终记录见上）</summary>
                              <pre>{String(v).slice(-10000)}</pre>
                            </details>
                          ))}
                      </>
                    )}
                  </aside>
                )}
              </div>
            </>
          )}
          {page === "tasks" && (
            <>
              <details className="card">
                <summary>手动登记任务（通常直接在会话中安排即可）</summary>
                <div className="section-heading">
                  <h2>新建任务与指定负责人</h2>
                  <p>
                    这里只登记目标与负责人，不会启动执行。Codex
                    任务使用“发送首次执行指令”；DSH 任务使用“提交 DSH
                    执行”，均需先核对范围和后果。
                  </p>
                  <span>不把闲聊转换成任务</span>
                </div>
                <form
                  className="task-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    const d = new FormData(f);
                    void act(async () => {
                      const values: any = Object.fromEntries(d);
                      values.parentTaskId = values.parentTaskId || null;
                      values.useUnity = values.useUnity === "true";
                      const kind = String(values.kind);
                      delete values.kind;
                      await api("tasks", { ...values, contract: { kind } });
                      f.reset();
                    }, "任务已登记");
                  }}
                >
                  <input
                    name="title"
                    aria-label="任务标题"
                    placeholder="可交付的任务标题"
                    required
                  />
                  <input
                    name="objective"
                    aria-label="任务目标"
                    placeholder="目标与完成条件"
                    required
                  />
                  <select name="owner" aria-label="指定负责人">
                    <option value="planner">主策划</option>
                    <option value="developer">主开发</option>
                  </select>
                  <select name="parentTaskId" aria-label="上级任务">
                    <option value="">无上级，登记为顶层任务</option>
                    {s.tasks.map((p:R)=><option value={p.id} key={p.id}>{p.title}</option>)}
                  </select>
                  <details className="task-advanced">
                    <summary>高级执行选项 · DSH / 工程验证 / 完成标准</summary>
                  <select
                    name="executor"
                    aria-label="执行方式"
                    onChange={(e) => {
                      if (e.currentTarget.value === "dsh") {
                        const purpose =
                          e.currentTarget.form?.elements.namedItem(
                            "purpose",
                          ) as HTMLSelectElement | null;
                        if (purpose) purpose.value = "product";
                      }
                    }}
                  >
                    <option value="codex">Codex 负责人直接处理</option>
                    <option value="dsh">
                      DSH 执行 · Codex 负责人核验
                    </option>
                  </select>
                  <select name="purpose" aria-label="任务用途">
                    <option value="product">研发工作</option>

                    <option value="unknown">来源待核对</option>
                  </select>
                  <select name="useUnity" aria-label="Unity工程验证"><option value="false">不使用Unity验证</option><option value="true">使用显式配置的Unity工程（需手动打开）</option></select>
                  <select name="kind" aria-label="完成标准类型">
                    <option value="analysis">文字分析与专业自查</option>
                    <option value="design">设计方案与专业自查</option>
                    <option value="implementation">
                      真实实现与执行验证（当前受限）
                    </option>
                  </select>
                  </details>
                  <select name="acceptance">
                    <option value="autonomous">凭证据自主完成</option>
                    <option value="producer">制作人指定验收</option>
                  </select>
                  <button className="primary" disabled={busy}>
                    登记任务
                  </button>
                </form>
              </details>
              <div className="section-heading">
                <h2>研发任务</h2>
                <input
                  placeholder="筛选标题 / 状态 / 负责人"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <details className="task-advanced">
                <summary>更多筛选（可选）</summary>
              <div className="actions">
                <label>
                  负责人
                  <select
                    aria-label="按负责人筛选"
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                  >
                    <option value="">全部</option>
                    <option value="planner">主策划</option>
                    <option value="developer">主开发</option>
                  </select>
                </label>
                <label>
                  阶段
                  <select
                    aria-label="按工作阶段筛选"
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                  >
                    <option value="">全部</option>
                    {[
                      "pending",
                      "running",
                      "blocked",
                      "awaiting_acceptance",
                      "completed",
                      "cancelled",
                      "unknown",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {labels[v]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              </details>
              <TaskTree snapshot={s} focusId={task} matched={filteredTasks.map((t:R)=>t.id)} limit={taskLimit} renderDetails={(t:R)=>(
                  <div className="task-expanded">
                  <TaskBrief task={t} snapshot={s} />



                  <ExecutionHistory records={(s.executions||[]).filter((j:R)=>j.taskId===t.id)} renderRecord={(j:R)=>(
                      <section key={j.id} className="notice">
                        <h4>DSH 执行记录 · {stateName(j.status)}</h4>
                        <DshActivity at={j.lastActivityAt} />
                        <p>
                          {j.error ||
                            (j.status === "finished_unverified"
                              ? "已收到原生结束事件；实际交付与验证请以负责人任务成果为准。"
                              : "") ||
                            "执行目标已记录；尚无可核验的完成结果。"}
                        </p>
                        <p>执行层不会自动完成任务；专业核验结论见任务成果。</p>
                        {j.unity && <aside role={j.unity.error ? "alert" : "status"}>
                          <p>团结环境：{({preparing:"核对环境",starting:"启动编辑器",connecting:"等待MCP身份确认",ready:"已核对配置工程",releasing:"正在清理",released:"本次环境已释放",disconnected:"连接异常，已停止执行",cleanup_required:"清理待核对，工程保持锁定"} as Record<string,string>)[j.unity.state]||"等待核对"}</p>
                          {j.unity.error&&<p>{j.unity.error}</p>}
                          {j.unity.borrowedEditorPreserved&&<p>用户自行启动的编辑器保持打开。</p>}
                        </aside>}
                        {j.stages?.length > 1 && <ol aria-label="执行阶段进度">
                          {j.stages.map((phase: R) => <li key={phase.id}>
                            {phase.title}：{({ pending: "尚未开始", dispatching: "提交中", running: "执行中", completed: "阶段已结束", failed: "阶段受阻", unknown: "结果待核对" } as Record<string, string>)[phase.state] || "待核对"}
                            {phase.checkpoint?.note && <p>{phase.checkpoint.note}</p>}
                            {phase.error && <p role="alert">本阶段未完成，请由负责人核对技术记录；后续阶段未自动重试。</p>}
                          </li>)}
                        </ol>}
                        {j.shellMode === "managed" && (
                          <p
                            role={
                              j.permissionState === "recovery_required"
                                ? "alert"
                                : "status"
                            }
                          >
                            {j.permissionState === "released"
                              ? "本次目录临时权限已回收。"
                              : j.permissionState === "recovery_required"
                                ? "目录权限回收待核对；已阻止新的 Shell 执行，请维护者处理。"
                                : "本次独立目录权限准备或执行中；尚未确认回收。"}
                          </p>
                        )}
                        {["preparing", "dispatching", "running"].includes(
                          j.status,
                        ) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              setInputPanel({
                                title: "停止本次 DSH 执行",
                                description:
                                  "停止该执行及其工具子进程，回收临时目录权限；保留文件、原生事件和任务。不会将任务标为完成，已产生的费用无法撤销。",
                                fields: [],
                                submit: async () => {
                                  const r = await api(
                                    `executions/${encodeURIComponent(j.id)}/stop`,
                                    { kind: "cancel" },
                                  );
                                  await refresh();
                                  return r;
                                },
                              })
                            }
                          >
                            停止本次执行
                          </button>
                        )}
                        <details>
                          <summary>执行身份、工作目录与原始证据</summary>
                          <p>{j.reason}</p>
                          <ReadableText text={j.summary || "尚无模型报告"} />
                          <Raw value={j} />
                          <button
                            onClick={() =>
                              void act(async () => {
                                const events = await api(
                                  `executions/${encodeURIComponent(j.id)}/events`,
                                );
                                setInputPanel({
                                  title: "DSH 原生执行证据",
                                  description:
                                    "保留真实事件类型；工具成功与模型结束均不等同任务验收通过。",
                                  fields: [],
                                  initialResult: { events },
                                  submit: async () => ({}),
                                });
                              }, "原生证据已读取")
                            }
                          >
                            读取原始执行事件
                          </button>
                        </details>
                        {j.status === "unknown" && (
                          <button
                            onClick={() =>
                              void act(
                                async () =>
                                  api(
                                    `executions/${encodeURIComponent(j.id)}/reconcile`,
                                    {},
                                  ),
                                "已核对本地原生事件；缺失终态时不会重发",
                              )
                            }
                          >
                            核对已保存执行证据
                          </button>
                        )}
                      </section>
                    )}/>
                  <details>
                    <summary>阅读完整成果、验证与反馈</summary>
                    <TaskOutcome task={t} snapshot={s} open={openArtifact} />
                  </details>
                  {taskActions(t)}
                  <details>
                    <summary>专业维护：特殊手工记录</summary>
                    <p>
                      日常由负责人提交成果；手工记录不代表系统复验。不会自动提升权限。
                    </p>
                    <button
                      onClick={() =>
                        openInput({
                          title: "手工记录成果与证据",
                          description:
                            "特殊导入入口；适用范围和验证来源须如实说明。原成果另存版本，不覆盖旧交付版本。",
                          fields: [
                            {
                              name: "summary",
                              label: "成果总结",
                              value: t.summary,
                            },
                            {
                              name: "evidence",
                              label: "证据引用（每行一项）",
                              value: t.evidence.join("\n"),
                            },
                          ],
                          submit: async (v) => {
                            const r = await api(
                              `tasks/${t.id}`,
                              {
                                status: "completed",
                                summary: v.summary,
                                evidence: v.evidence
                                  .split("\n")
                                  .filter(Boolean),
                              },
                              "PATCH",
                            );
                            await refresh();
                            return r;
                          },
                        })
                      }
                    >
                      记录成果与证据
                    </button>
                    <button
                      onClick={() =>
                        openInput({
                          title: "更正任务登记",
                          description:
                            "仅更正账本状态，不代表实际执行、中断或验证通过。必须说明原因，旧记录继续保留；已有未知指令时禁止以取消替代核对。",
                          fields: [
                            {
                              name: "status",
                              label: "登记阶段",
                              value: "blocked",
                              options: [
                                "pending",
                                "blocked",
                                "unknown",
                                "cancelled",
                                "error",
                              ].map((v) => ({ value: v, label: labels[v] })),
                            },
                            {
                              name: "correctionReason",
                              label: "更正原因与依据",
                            },
                          ],
                          submit: async (v) => {
                            const r = await api(
                              `tasks/${t.id}`,
                              { ...v, expectedUpdatedAt: t.updatedAt },
                              "PATCH",
                            );
                            await refresh();
                            return r;
                          },
                        })
                      }
                    >
                      更正任务登记
                    </button>
                  </details>
                  <details>
                    <summary>来源、任务 ID 与验收记录</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          ...t,
                          relatedMessages: s.messages.filter(
                            (m: R) => m.taskId === t.id,
                          ),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  </div>
              )}/>
              {filteredTasks.length > taskLimit && (
                <button onClick={() => setTaskLimit((v) => v + 30)}>
                  加载更多任务记录
                </button>
              )}
              {!filteredTasks.length && (
                <section className="card">
                  <p>
                    当前没有匹配任务，可清除筛选或登记新目标。
                  </p>
                </section>
              )}
              {!s.tasks.length && (
                <section className="card">
                  <Empty
                    title="暂无已登记的工作包"
                    text="直接对话无需建单。有明确交付目标时再登记。"
                  />
                </section>
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <RuleCenter api={api}/>
              <section className="card">
                <h2>运行与工作范围</h2><p>研发工程：{s.project?.root || "尚未配置"}</p><p>Unity默认手动启动：请先打开正确工程，再通过已配置的回环MCP核对身份；工作台不会反复拉起或关闭编辑器。</p><button disabled={busy || !s.project?.root} onClick={()=>void act(()=>api("unity/check",{}),"Unity工程身份已核对")}>核对Unity连接</button>
                <p>
                  {s.connected ? "后台已连接" : "后台未连接"} ·{" "}
                  {s.authenticated ? "认证可用" : "需要登录"}
                  。认证可用不等于命令执行可用。
                </p>
                <p>
                  Codex负责人保持只读 / never；DSH仅在明确授权的任务目录执行。项目接入需单独配置和授权；普通用户进程不等于完整操作系统隔离。
                </p>
                <p>
                  两位负责人默认直接使用简体中文；技术记录保留原文。关闭网页不会关闭后台。
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() => api("backup", {}), "数据库一致性备份已保存")
                  }
                >
                  备份数据库
                </button>
                <p>
                  数据库备份不含认证和原生会话目录。完整备份需正常停服后私有保存
                  CODEX_HOME；恢复只创建新副本，不覆盖运行库。
                </p>
              </section>
              <section className="card">
                <h2>DSH 开发执行层</h2>
                <p>
                  {s.dsh?.allowed
                    ? "官方 SDK 已启用；模型结果由原 Codex 负责人专业核验。"
                    : "DSH 尚未启用；原工作台功能继续可用。"}
                </p>
                <p>{s.dsh?.reason}</p>
                <details>
                  <summary>SDK 状态与运行限制</summary>
                  <Raw value={s.dsh} />
                </details>
              </section>
              <details>
                <summary>专业诊断与恢复</summary>
                <Raw
                  label="查看最近原始事件（完整账本可由开发核对）"
                  value={s.events}
                />
                <p>
                  以下恢复可能继续已确认待发消息；绑定与持续目标操作需明确核对对象，不增加执行权限。
                </p>
                <div className="settings-grid">
                  <section className="card">
                    <h2>执行连接</h2>
                    <dl>
                      <dt>Codex CLI</dt>
                      <dd className="mono">{s.config.exe}</dd>
                      <dt>独立 CODEX_HOME</dt>
                      <dd className="mono">{s.config.home}</dd>
                      <dt>工作目录</dt>
                      <dd className="mono">{s.config.project}</dd>
                      <dt>执行边界</dt>
                      <dd>{s.config.permissions} · 正式 RRPG 未接入</dd>
                    </dl>
                    <p>
                      此独立认证目录不复制桌面 App 凭据。使用下方命令在终端完成
                      CLI 登录，然后刷新连接。
                    </p>
                    <pre>{`$env:CODEX_HOME='${s.config.home}'\ncodex login`}</pre>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() => void act(() => api("connect", {}))}
                      >
                        连接 / 刷新认证
                      </button>
                      <button
                        disabled={busy || !s.connected}
                        className="primary"
                        onClick={() =>
                          void act(
                            () => api("initialize", {}),
                            "两个负责人已初始化；已有绑定会保留",
                          )
                        }
                      >
                        初始化两位负责人
                      </button>
                      <button
                        onClick={() =>
                          void act(
                            () => api("backup", {}),
                            "数据库一致性备份已保存",
                          )
                        }
                      >
                        备份数据库
                      </button>
                    </div>
                    {s.lastError && (
                      <div>
                        {errorSummary(s.lastError)}
                        <Raw label="查看最近错误原文" value={s.lastError} />
                      </div>
                    )}
                  </section>
                  <section className="card">
                    <h2>原生能力状态</h2>
                    {Object.entries(s.diagnostics).map(
                      ([k, v]: [string, any]) => (
                        <div className="capability" key={k}>
                          <strong>
                            {(
                              {
                                queue: "消息排队",
                                steer: "调整执行方向",
                                interrupt: "中断执行",
                                goals: "持续目标",
                                dynamicTools: "负责人协作工具",
                                history: "会话恢复",
                                execution: "命令执行环境",
                              } as R
                            )[k] || "原生能力"}
                          </strong>
                          <span>
                            {v.status === "unverified"
                              ? "真实行为待验证"
                              : stateName(v.status)}
                          </span>
                          {v.mode && (
                            <small>
                              当前模式：
                              {v.mode === "outbox"
                                ? "工作台待派发队列"
                                : "原生模式"}
                            </small>
                          )}
                          <p>
                            {k === "execution"
                              ? "Windows 执行环境仍有阻塞，不能将界面可用视为代码执行通过。"
                              : "历史验证与当前观测分别记录，详细边界请查看技术数据。"}
                          </p>
                          <Raw
                            label="查看原始能力记录"
                            value={{ name: k, ...v }}
                          />
                        </div>
                      ),
                    )}
                    <p className="muted">
                      模拟测试与真实 Codex
                      验证分别报告。接口可调用不表示完整功能通过验收。
                    </p>
                  </section>
                </div>
                <div className="agent-grid">
                  {s.agents.map((a: R) => (
                    <section className="card" key={a.id}>
                      <h2>{names[a.id]}会话管理与持续目标</h2>
                      <Badge value={a.status} />
                      <AgentStatus agent={a} snapshot={s} />
                      <p>恢复或替换保留历史。未知执行未核对前禁止替换。</p>
                      <div className="actions">
                        <button
                          onClick={() => {
                            openInput({
                              title: "受控绑定 / 替换",
                              description: `对象：${names[a.id]}。保留旧历史；后台严格核对未知执行与原生记录。不得创建替代 Thread 绕过限制。`,
                              fields: [
                                {
                                  name: "threadId",
                                  label: "已核实的原 Thread ID",
                                  value: a.threadId,
                                },
                              ],
                              submit: (v) =>
                                api(`agents/${a.id}/binding`, {
                                  ...v,
                                  revision: a.revision,
                                }),
                            });
                          }}
                        >
                          受控绑定 / 替换
                        </button>
                        <button
                          disabled={busy || !a.threadId || !s.authenticated}
                          onClick={() =>
                            void act(() =>
                              api(`agents/${a.id}/recreate-missing`, {}),
                            )
                          }
                        >
                          修复未持久化空绑定
                        </button>
                        <button
                          disabled={!a.threadId}
                          onClick={() =>
                            void act(() => api(`agents/${a.id}/reconcile`, {}))
                          }
                        >
                          核对与恢复
                        </button>
                      </div>
                      <p>
                        {a.goal
                          ? "已读取原生持续目标"
                          : "当前没有已读取的持续目标"}
                      </p>
                      <Raw label="查看原生 Goal 数据" value={a.goal || null} />
                      <div className="actions">
                        <button
                          disabled={!a.threadId}
                          onClick={() => {
                            openInput({
                              title: "设定原生 Goal",
                              description:
                                "仅明确授权的持续目标，可能消耗额度并持续运行；不等于登记任务。仍只读 / never。",
                              fields: [
                                { name: "objective", label: "明确的持续目标" },
                              ],
                              submit: (v) =>
                                api(`agents/${a.id}/goal`, {
                                  action: "active",
                                  ...v,
                                }),
                            });
                          }}
                        >
                          设定原生 Goal
                        </button>
                        <button
                          disabled={!a.threadId}
                          onClick={() =>
                            void act(() =>
                              api(`agents/${a.id}/goal`, { action: "paused" }),
                            )
                          }
                        >
                          暂停 Goal
                        </button>
                        <button
                          disabled={!a.threadId}
                          onClick={() =>
                            void act(() =>
                              api(`agents/${a.id}/goal`, { action: "clear" }),
                            )
                          }
                        >
                          清除 Goal
                        </button>
                      </div>
                    </section>
                  ))}
                </div>
                <section className="card">
                  <div className="section-heading">
                    <h2>设计交接</h2>
                    <div className="actions">
                      <button
                        onClick={() =>
                          void act(
                            () => api("handoffs/scan", {}),
                            "已扫描交接；详情见记录",
                          )
                        }
                      >
                        扫描交接目录
                      </button>
                    </div>
                  </div>
                  <p className="mono">{s.config.inbox}</p>
                  <p>
                    在此目录放置
                    JSON：id、title、content、producerConfirmed:true、provenance。只接收当前工作目录的明确交接，不自动批准设计或执行权限。
                  </p>
                  {s.handoffs.map((h: R) => (
                    <div className="decision" key={h.id}>
                      <h3>{h.title}</h3>
                      <Badge value={h.status} />
                      <p>
                        {h.id} · {h.fingerprint}
                      </p>
                      <button
                        disabled={h.status !== "discovered"}
                        onClick={() =>
                          void act(() => api(`handoffs/${h.id}/notify`, {}))
                        }
                      >
                        通知主策划一次
                      </button>
                      <button
                        disabled={h.status !== "notified"}
                        onClick={() => {
                          openInput({
                            title: "手工记录交接审查",
                            description:
                              "主策划应自主专业审查；此处仅补录已完成的审查并通知主开发，不自动批准设计权威或权限。",
                            fields: [
                              { name: "summary", label: "实际审查结论" },
                              { name: "evidence", label: "审查证据引用" },
                            ],
                            submit: (v) =>
                              api(`handoffs/${h.id}/review`, {
                                summary: v.summary,
                                evidence: v.evidence
                                  .split("\n")
                                  .filter(Boolean),
                              }),
                          });
                        }}
                      >
                        记录审查并交给主开发
                      </button>
                    </div>
                  ))}
                </section>
              </details>
            </>
          )}
          <footer>
            事实来自 Studio 账本与原生执行证据 · 未知执行不会自动重派
            <span>RRPG AI Studio · 本地</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <div>◌</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Activity({ events }: { events: R[] }) {
  return (
    <div className="activity">
      {events.length ? (
        events.map((e) => (
          <div className="activity-row" key={e.seq}>
            <i />
            <div>
              <strong>{eventName(e.type)}</strong>
              <small>{time(e.observed_at)}</small>
              <details>
                <summary>查看证据 · #{e.seq}</summary>
                <pre>
                  {JSON.stringify({ type: e.type, ...e.data }, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        ))
      ) : (
        <Empty title="尚无研发活动" text="事件会在实际发生后记录。" />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
