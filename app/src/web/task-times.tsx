import React from "react";
import { taskTimes } from "./task-progress.js";
type Row = Record<string, any>;
export function TaskTimes({ task, snapshot }: { task: Row; snapshot: Row }) {
  const times = taskTimes(task, snapshot);
  const render = (at: string | null, missing: string) => at ? <time dateTime={at}>{new Date(at).toLocaleString("zh-CN", { hour12: false })}</time> : missing;
  return <span className="task-summary-brief" aria-label="任务时间记录">
    <span>创建：{render(times.created, "未记录")}</span>{" · "}
    <span>首次执行：{render(times.started, "尚无实际开始记录")}</span><br />
    <span title="任务、关联指令或执行记录最后发生更新的时间；不等同实际执行活动">最新记录更新：{render(times.updated, "未记录")}</span>{" · "}
    <span title="仅使用本任务直接关联DSH的原生事件时间，不使用页面刷新或传输确认时间">最近 DSH 活动：{render(times.activity, "尚无带时间的执行事件")}</span>
    <span>（本机时间）</span>
  </span>;
}
