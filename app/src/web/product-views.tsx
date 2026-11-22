import React, { useState } from "react";
import {
  taskPurpose,
  checkNames,
  modeNames,
  readyForProducer,
} from "../shared/product.js";
import { Raw, MessageBody, stateName } from "./presentation.js";
import { taskProgress } from "./task-progress.js";
type R = Record<string, any>;
export { taskPurpose, readyForProducer };
const names: R = {
  planner: "主策划",
  developer: "主开发",
  producer: "制作人",
  system: "系统",
};
export function TaskBrief({ task, snapshot }: { task: R; snapshot: R }) {
  const progress = taskProgress(task, snapshot);
  const d = (snapshot.deliveries || [])
    .filter((d: R) => d.taskId === task.id)
    .at(-1);
  return (
    <div>
      <section aria-label="任务进展说明" className="notice">
        <p><strong>研发目标：</strong>{task.title}</p>
        <p><strong>当前情况：</strong>{progress.status}</p>
        <p><strong>负责推进：</strong>{progress.owner}{snapshot.dsh?.maintenance && "；技术维护端负责恢复核验"}</p>
        <p><strong>下一步：</strong>{progress.next}</p>
        <p><strong>你需要做什么：</strong>{progress.action}</p>
        <p><strong>交付情况：</strong>{d ? "已有负责人提交的成果，详见下方交付与验证；提交不代表全部通过。" : "尚无整理完整的成果交付，不能认定任务已完成。"}</p>
        <p><strong>验证情况：</strong>{d?.checks?.length ? d.checks.map((c: R) => `${c.title}：${checkNames[c.result]}（${modeNames[c.mode]}）`).join("；") : "尚未整理验证结论；不代表完全没做过测试，也不能视为通过。"}</p>
        {task.updatedAt && <p>任务记录更新时间：<time dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleString("zh-CN", {hour12:false})}</time>（不代表最近执行活动）</p>}
      </section>
      {(snapshot.annotations || [])
        .filter((a: R) => a.taskId === task.id && a.conflict)
        .map((a: R) => (
          <p className="operation-impact" role="alert" key={a.id}>
            {a.conflict}
          </p>
        ))}
      <details><summary>原始任务要求与负责人技术记录</summary>
        <p className="message-content">完整要求：{task.objective}</p>
        <p className="message-content">负责人原始记录：{task.summary || "暂无"}</p>
        <p>账本任务状态：{stateName(task.status)}；上方说明结合当前投递与执行记录，不改写原始状态。</p>
      </details>
    </div>
  );
}
export function Artifact({
  artifact,
  open,
}: {
  artifact: R;
  open: (path: string) => void;
}) {
  return (
    <div className="artifact">
      <strong>{artifact.title}</strong>
      {artifact.kind === "text" ? (
        <div className="message-content">{artifact.value}</div>
      ) : artifact.kind === "project-file" ? (
        <>
          <p>仅查看已配置工程的小文本；打开时核对路径和内容，不运行文件。</p>
          <button onClick={() => open(artifact.value)}>查看项目文档</button>
        </>
      ) : (
        <>
          <p>原型入口尚未安全核验；不能标为可体验。</p>
          <Raw label="查看待核验引用" value={artifact.value} />
        </>
      )}
    </div>
  );
}
export function TaskOutcome({
  task,
  snapshot,
  open,
}: {
  task: R;
  snapshot: R;
  open: (path: string) => void;
}) {
  const deliveries = (snapshot.deliveries || []).filter(
      (d: R) => d.taskId === task.id,
    ),
    d = deliveries.at(-1);
  const notes = (snapshot.annotations || []).filter(
    (a: R) => a.taskId === task.id,
  );
  return (
    <div className="outcome">
      {notes.map((n: R) => (
        <div key={n.id} className="alert notice">
          <p>{n.note}</p>
          {n.conflict && <p role="alert">{n.conflict}</p>}
          <Raw label="查看分类依据" value={n} />
        </div>
      ))}
      <h4>目标与边界</h4>
      <p className="message-content">{task.objective}</p>
      <p>{task.contract?.scope || "未单独记录；仅限当前明确授权范围"}</p>
      <h4>当前工作</h4>
      <p>
        {names[task.owner]} · 登记状态：{stateName(task.status)}
        。状态不等于验证通过。
      </p>
      <h4>实际交付</h4>
      <p className="message-content">
        {d?.summary ||
          task.summary ||
          "尚未提交成果；请负责人完成专业工作后整理。"}
      </p>
      {d && (
        <p>
          第 {d.version} 版 · {d.scope} · {d.provenance}
        </p>
      )}
      {(d?.artifacts || []).map((a: R, i: number) => (
        <Artifact key={i} artifact={a} open={open} />
      ))}
      <h4>专业验证</h4>
      {!d?.checks?.length ? (
        <p>未提供结构化验证；已有文字/技术证据不自动代表真实执行通过。</p>
      ) : (
        d.checks
          .filter(
            (c: R) => c.result === "passed" || c.result === "not_applicable",
          )
          .map((c: R) => (
            <p key={c.id}>
              {c.title}：{checkNames[c.result]} · {modeNames[c.mode]}
            </p>
          ))
      )}
      <h4>尚未完成的验证与问题</h4>
      {(task.contract?.requiredChecks || [])
        .filter(
          (c: R) =>
            !d?.checks?.some(
              (x: R) =>
                x.id === c.id && x.result === "passed" && x.mode === c.mode,
            ),
        )
        .map((c: R) => (
          <p key={c.id}>{c.title}：尚未满足完成条件</p>
        ))}
      {d?.checks
        ?.filter((c: R) => !["passed", "not_applicable"].includes(c.result))
        .map((c: R) => (
          <p key={c.id}>
            {c.title}：{checkNames[c.result]} · {modeNames[c.mode]}
          </p>
        ))}
      <p>{d?.issues || "历史未单独记录，不代表没有缺口。"}</p>
      <h4>制作人反馈</h4>
      {(task.acceptanceHistory || []).length ? (
        (task.acceptanceHistory || []).map((a: R, i: number) => (
          <p key={i}>
            {
              (
                {
                  approve: "认可本次范围",
                  discuss: "询问",
                  revise: "要求调整",
                } as R
              )[a.action]
            }
            ：{a.comment}
          </p>
        ))
      ) : (
        <p>
          {task.acceptance === "producer"
            ? "保留明确人工评审要求；尚无反馈。"
            : "普通专业工作由负责人自主验证，无需逐项人工批准。"}
        </p>
      )}
      {task.status === "awaiting_acceptance" &&
        (d?.review ? (
          <div>
            <p>为何需要你：{d.review.reason}</p>
            <p>需要判断：{d.review.question}</p>
            <ul>
              {d.review.options.map((o: string) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <p>未决定的影响：{d.review.impact}</p>
            <p>后续执行：{names[task.owner]}</p>
          </div>
        ) : (
          <p className="operation-impact">
            评审材料待原负责人整理；请勿仅凭技术证据盲目批准。
          </p>
        ))}
      <h4>下一步</h4>
      <p>
        {d?.next ||
          "由原负责人核对目标和验证条件后提供下一步；没有自动推断新计划。"}
      </p>
      <details>
        <summary>历史交付版本与技术证据（{deliveries.length} 版）</summary>
        <Raw value={{ deliveries, evidence: task.evidence }} />
      </details>
    </div>
  );
}
export function TaskTimeline({ task, snapshot }: { task: R; snapshot: R }) {
  const messages = snapshot.messages.filter(
    (m: R) => m.taskId === task.id || task.messages?.includes(m.id),
  );
  return (
    <details>
      <summary>本任务指令与反馈（{messages.length}）</summary>
      {messages.map((m: R) => (
        <article className="native-text" key={m.id}>
          <strong>
            {names[m.sender]} ·{" "}
            {m.nativeItemId ? "原生答复记录" : stateName(m.delivery)}
          </strong>
          <MessageBody message={m} />
          <Raw label="查看消息关联与原始记录" value={m} />
        </article>
      ))}
      {!messages.length && <p>暂无关联指令；登记任务本身不会开始执行。</p>}
    </details>
  );
}
export function Progress({
  rows,
  snapshot,
  loadMore,
}: {
  rows: R[];
  snapshot: R;
  loadMore?: () => void;
}) {
  const grouped = new Map<string, R>();
  for (const e of rows) {

    grouped.set(e.data.id, e);
  }
  return (
    <div>
      {[...grouped.values()].reverse().map((e) => (
        <div className="activity-row" key={e.data.id}>
          <div>
            <strong>{e.data.title || e.data.question}</strong>
            <p>
              {names[e.data.owner] || "负责人"} ·{" "}
              {e.type.startsWith("decisions")
                ? "提出产品判断事项"
                : stateName(e.data.status)}
              {e.data.summary ? "；已提交成果摘要，验证范围见任务详情。" : ""}
            </p>
            <small>{new Date(e.observed_at).toLocaleString("zh-CN")}</small>
            <Raw label="查看进展依据" value={e} />
          </div>
        </div>
      ))}
      {!grouped.size && (
        <p>当前覆盖范围内没有新的研发事项；没有待处理的进展。</p>
      )}
      {loadMore && <button onClick={loadMore}>加载更早未读范围的下一页</button>}
    </div>
  );
}
