type Row = Record<string, any>;
function timestamp(value: unknown): number | null {
  const n = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 8640000000000000 ? n : null;
}
export function taskTimes(task: Row, snapshot: Row) {
  const jobs = (snapshot.executions || []).filter((j: Row) => j.taskId === task.id);
  const messages = (snapshot.messages || []).filter((m: Row) => m.taskId === task.id || task.messages?.includes(m.id));
  const messageIds = new Set(messages.map((m: Row) => m.id));
  const runs = (snapshot.runs || []).filter((r: Row) => task.runs?.includes(r.id) || r.linkedMessages?.some((id: string) => messageIds.has(id)));
  const iso = (values: unknown[], first = false) => {
    const times = values.map(timestamp).filter((n): n is number => n !== null);
    return times.length ? new Date(first ? Math.min(...times) : Math.max(...times)).toISOString() : null;
  };
  return {
    created: iso([task.createdAt]),
    started: iso([task.startedAt, ...jobs.map((j: Row) => j.startedAt), ...runs.map((r: Row) => r.startedAt)], true),
    updated: iso([task.updatedAt, ...jobs.map((j: Row) => j.updatedAt), ...messages.map((m: Row) => m.updatedAt)]),
    activity: iso(jobs.map((j: Row) => j.lastActivityAt)),
  };
}
export const pendingDelivery = ["recorded", "dispatching", "accepted", "in_progress", "queued_native", "unknown"];
export function taskProgress(task: Row, snapshot: Row) {
  const family = new Set([task.id]);
  const children = new Map<string, string[]>();
  for (const t of snapshot.tasks || []) if(t.parentTaskId)children.set(t.parentTaskId,[...(children.get(t.parentTaskId)||[]),t.id]);
  const queue=[task.id];for(let i=0;i<queue.length;i++)for(const id of children.get(queue[i])||[])if(!family.has(id)){family.add(id);queue.push(id);}
  const messages = (snapshot.messages || []).filter((m: Row) => family.has(m.taskId) || task.messages?.includes(m.id));
  const waiting = messages.filter((m: Row) => pendingDelivery.includes(m.delivery));
  const jobs = (snapshot.executions || []).filter((j: Row) => family.has(j.taskId));
  const active = jobs.find((j: Row) => ["preparing", "dispatching", "running", "verifying", "cancelling"].includes(j.status));
  const unknown = jobs.some((j: Row) => j.status === "unknown") || waiting.some((m: Row) => m.delivery === "unknown");
  const owner = task.owner === "planner" ? "主策划" : "主开发";
  let status: string, next: string, action = "无需重复派发；常规推进与技术核验由负责人处理。";
  if (["completed", "cancelled"].includes(task.status)) {
    status = task.status === "completed" ? "已登记完成" : "已取消";
    next = "完成状态与实际验证分别记录，请查看交付与验证范围。";
  } else if (active) {
    status = (active.taskId!==task.id?"下级任务 · ":"") + (active.status === "cancelling" ? "DSH 正在停止，尚未确认退出" : active.status === "verifying" ? "正在验证执行结果" : active.status === "running" ? "DSH 执行中" : "DSH 正在准备或连接");
    next = `${owner}负责核验执行结果；执行结束不等于任务验收通过。`;
  } else if (unknown) {
    status = "上次执行或投递结果待核对";
    next = "负责人和技术维护端先核对原执行，避免重复修改或重复测试。";
    action = "无需盲目重发，也不需要批准未知结果。";
  } else if (snapshot.dsh?.maintenance) {
    status = waiting.some((m: Row) => m.delivery === "recorded") ? "维护暂停 · 指令尚未发送" : "维护暂停 · 自动派发已停止";
    next = "技术维护端完成恢复核验后，工作台才能继续派发；已有指令保留。";
    action = "当前无需你操作，请勿重复点击继续。";
  } else if (waiting.length) {
    status = waiting.some((m: Row) => m.delivery === "recorded") ? "指令已登记，等待发送" : "指令已提交，等待负责人处理";
    next = `${owner}在原会话接手；消息投递不等于实际开发完成。`;
  } else if (task.status === "blocked") {
    status = "任务受阻，尚未恢复";
    next = `${owner}需整理阻塞原因及处理方案；仅凭状态无法判断是否需要你决定。`;
  } else if (task.status === "awaiting_acceptance") {
    status = task.acceptance === "producer" ? "等待制作人验收" : "等待核验结论";
    next = "先查看实际交付、已验证与未验证范围，再作判断。";
    action = task.acceptance === "producer" ? "材料清楚且可判断时再验收；材料不齐可要求负责人补充。" : "由负责人完成专业核验，不自动要求制作人批准。";
  } else if (task.status === "pending") {
    status = "待安排 · 当前没有待发指令";
    next = `${owner}需核对下一步；这不表示 AI 正在执行。`;
    action = "如尚未授权执行，可进入负责人会话说明范围；已授权的任务无需反复批准。";
  } else {
    status = "任务尚未结束 · 当前无活跃 DSH 执行";
    next = `${owner}需汇报当前进展；任务状态本身不能证明执行仍在进行。`;
  }
  return { status, next, action, owner, waiting: waiting.length, active: Boolean(active), blockedSend: Boolean(snapshot.dsh?.maintenance || waiting.length || active || unknown) };
}
