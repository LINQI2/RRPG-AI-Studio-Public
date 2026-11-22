import React from "react";
type Row = Record<string, any>;
export const statusNames: Record<string, string> = {
  awaiting_acceptance: "待制作人验收",
  cancelled: "已取消",
  idle: "空闲",
  error: "异常",
  dispatching: "派发中",
  inProgress: "执行中",
  in_progress: "执行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  pending: "待处理",
  running: "执行中",
  blocked: "阻塞",
  unknown: "状态未知",
  unverified: "待真实验证",
  partially_verified: "部分验证",
  degraded: "安全降级",
  "requires-attention": "需要处理",
  accepted: "已接收",
  recorded: "待派发",
  notification: "仅通知",
  discovered: "待交接",
  notified: "已通知",
  review_recorded: "已记录审查",
  queued_native: "原生排队中",
  final_answer: "最终回复",
  commentary: "过程说明",
  open: "待答复",
  stale: "已失效",
  answered: "已答复",
  active: "执行中",
  paused: "已暂停",
  preparing: "正在准备独立执行环境",
  verifying: "正在验证实际成果",
  preflight: "正在检查测试启动条件",
  requested: "测试已请求，等待原生结果",
  rejected: "测试未启动：前置条件不满足",
  passed: "验证通过",
  cancelling: "正在停止执行并回收权限",
  finished_unverified: "执行已结束，专业结论见任务成果",
};
export function stateName(value: any) {
  return statusNames[String(value)] || `原生状态：${String(value || "未提供")}`;
}
export function errorSummary(error: any) {
  const text = typeof error === "string" ? error : JSON.stringify(error);
  if (
    /仅.*授权|独立目录 Shell|无效执行目录|执行已结束或结果未知|DSH 执行当前仅授权|该任务使用 DSH|两个独立执行|原执行尚未解决|后台正在关闭|DSH 恢复当前不可用/.test(
      text,
    )
  )
    return text.replace(/^Error: /, "");
  if (
    /完成条件尚未满足|评审材料尚未齐备|任务有未结束|不能手工把任务/.test(text)
  )
    return text.replace(/^Error: /, "");
  if (/401|authenticate|unauthorized/i.test(text))
    return "认证状态需要更新，请到设置检查登录。";
  if (/Active Turn changed|Binding changed/i.test(text))
    return "会话或执行轮次已变化，请刷新后重试。";
  if (/Idempotency key/i.test(text))
    return "提交标识与原消息内容冲突，请核对消息，避免重复派发。";
  if (/blocked by policy|native MXC|sandbox/i.test(text))
    return "原生命令受到执行环境限制；当前不能确认执行成功。";
  if (/unknown|uncertain|reconciliation|unresolved/i.test(text))
    return "执行状态需要核对，请先读取原生历史，不要重复发送。";
  if (/EACCES|EPERM/i.test(text))
    return "执行环境拒绝了访问，请核对权限；不要重复操作或自行放宽权限。";
  if (/fetch|ECONN|network|timeout/i.test(text))
    return "连接或等待未完成，请检查后台状态；尚不能确认是否执行。";
  if (/requires summary|Completion requires/i.test(text))
    return "请补充交付总结和真实证据后再提交。";
  if (/403|Only owner|sender|permission/i.test(text))
    return "当前操作不符合权限或身份要求。";
  return "操作未完成，请核对状态；原始错误已保留。";
}
const toolNames: Record<string, string> = {
  studio_send_message: "负责人间通信",
  studio_task: "登记或更新任务",
  studio_request_decision: "向制作人请求决定",
  exec_command: "执行命令",
  exec: "原生程序化工具调用",
  apply_patch: "修改文件",
};
export function itemSummary(item: Row) {
  const type = item.rawType || item.type || "未提供类型";
  const name = item.tool || item.name;
  let action =
    toolNames[name] ||
    (name
      ? `原生工具：${name}`
      : (
          {
            commandExecution: "执行命令",
            dynamicToolCall: "负责人工具调用",
            fileChange: "文件变更",
            agentMessage: "负责人回复",
            userMessage: "输入消息",
            reasoning: "原生推理摘要",
            mcpToolCall: "外部工具调用",
          } as Row
        )[type] || `未识别的原生记录：${type}`);
  let result = "已记录，结果待核对";
  if (item.success === true) result = "工具返回成功";
  else if (item.success === false) result = "工具返回失败";
  else if (typeof item.exitCode === "number")
    result =
      item.exitCode === 0
        ? "命令退出码为 0"
        : `命令失败，退出码 ${item.exitCode}`;
  else if (
    /Script failed|Script error|blocked by policy/.test(
      JSON.stringify(item.output || ""),
    )
  )
    result = "原始结果包含执行错误";
  else if (item.completedAt) result = "已返回结果，成功与否待核对";
  else if (item.status) result = stateName(item.status);
  return { action, result, type };
}
export function Raw({
  label = "查看原始数据",
  value,
}: {
  label?: string;
  value: any;
}) {
  return (
    <details className="raw-data">
      <summary>{label}</summary>
      <pre>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
export function TechnicalItem({ item }: { item: Row }) {
  const summary = itemSummary(item);
  return (
    <details className="tool-record">
      <summary>
        {summary.action} · {summary.result}
      </summary>
      <p className="muted">
        记录类型：{summary.type}。状态只反映原生返回，不代表任务已验收。
      </p>
      <Raw label="查看原始工具数据" value={item} />
    </details>
  );
}
export function NativeTurn({ turn }: { turn: Row }) {
  return (
    <details className="native-turn">
      <summary>执行轮次 · {stateName(turn.status)}</summary>
      <p className="mono">轮次编号：{turn.id}</p>
      {(turn.items || []).map((item: Row, index: number) =>
        ["agentMessage", "userMessage"].includes(item.type) ? (
          <div className="native-text" key={item.id || index}>
            <strong>
              {item.type === "agentMessage" ? "负责人原生回复" : "原生输入"}
            </strong>
            <div>
              {item.text ||
                item.content
                  ?.filter(
                    (c: Row) => c.type === "text" || c.type === "inputText",
                  )
                  .map((c: Row) => c.text)
                  .join("\n") ||
                "此消息内容请查看原始数据"}
            </div>
            <Raw value={item} />
          </div>
        ) : (
          <TechnicalItem key={item.id || index} item={item} />
        ),
      )}
      {(turn.nativeToolEvidence || []).map((item: Row, index: number) => (
        <TechnicalItem key={"rollout:" + item.id + index} item={item} />
      ))}
      <Raw label="查看完整原始轮次（JSON）" value={turn} />
    </details>
  );
}
export function MessageBody({ message }: { message: Row }) {
  const text = String(message.content || "");
  if (message.sender === "dsh-supervisor")
    return <div><p>定时进展检查已交原负责人核对；不代表新授权、任务完成或重新执行。</p><Raw label="查看定时检查依据" value={text} /></div>;
  if (message.sender === "dsh-executor")
    return (
      <div>
        <p>
          DSH
          执行层回报已转交负责人；实际成果、验证与阻塞请查看关联任务。原始通知已收起。
        </p>
        <Raw label="查看执行层原始通知" value={text} />
      </div>
    );
  // Explicit content declarations only; JSON syntax and language are not authority.
  const technical =
    message.contentType === "technical" || message.contentType === "code";
  return technical ? (
    <div>
      <p>负责人返回了技术数据，原文已收起。</p>
      <Raw label="查看消息原文" value={text} />
    </div>
  ) : (
    <div className="message-content">{text}</div>
  );
}
export function eventName(type: string) {
  const exact: Row = {
    "message.recorded": "消息已记录",
    "message.accepted": "消息已派发",
    "tool.response": "工具已返回",
    "execution.preflight": "执行环境已检查",
    "transport.connected": "后台已连接",
    "goal.producer_action": "制作人更新了持续目标",
    "agent.bound": "负责人会话已绑定",
    "lead.instructions_updated": "负责人沟通规范已更新",
  };
  return (
    exact[type] ||
    (type.endsWith(".updated")
      ? "工作记录已更新"
      : type.endsWith(".created")
        ? "新增工作记录"
        : "研发活动记录")
  );
}
export function inMessageView(message: Row, role: string) {
  return role === "peers"
    ? ["planner", "developer"].includes(message.sender) &&
        ["planner", "developer"].includes(message.recipient) &&
        message.sender !== message.recipient
    : message.recipient === role || message.sender === role;
}
export function ReadableText({ text }: { text: string }) {
  return <p className="message-content">{text}</p>;
}
