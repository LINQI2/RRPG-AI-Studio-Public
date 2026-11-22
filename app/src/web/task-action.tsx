import React, { useEffect, useRef, useState } from "react";
import { Raw, ReadableText, errorSummary, stateName } from "./presentation.js";
import { taskProgress } from "./task-progress.js";
type Row = Record<string, any>;
export const taskActionNames: Row = {
  start: "发送首次执行指令",
  continue: "继续已有任务",
  resend: "重新执行已结束任务",
  revise: "要求修改",
  discuss: "继续讨论",
  approve: "通过验收",
};
export function TaskActionPanel({
  task,
  action,
  snapshot,
  submit,
  onClose,
  onChat,
}: {
  task: Row;
  action: string;
  snapshot: Row;
  submit: (body: Row) => Promise<Row>;
  onClose: () => void;
  onChat: () => void;
}) {
  const storageKey = `studio-task-action:${task.id}:${action}`;
  const [stored] = useState<Row | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  });
  const [comment, setComment] = useState(stored?.comment || "");
  const [confirmed, setConfirmed] = useState(!!stored);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Row | null>(null);
  const lock = useRef(false);
  const key = useRef(stored?.clientRequestId || crypto.randomUUID());
  const original = useRef(task);
  const originalDelivery = useRef(
    (snapshot.deliveries || []).filter((d: Row) => d.taskId === task.id).at(-1)
      ?.id || null,
  );
  const originalBinding = useRef(
    snapshot.agents.find((a: Row) => a.id === task.owner)?.revision,
  );
  const payload = useRef<Row | null>(stored);
  const heading = useRef<HTMLHeadingElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    heading.current?.focus();
    return () => prev?.focus();
  }, []);
  const owner = snapshot.agents.find((a: Row) => a.id === task.owner);
  const latest = snapshot.tasks.find((t: Row) => t.id === task.id);
  const blockedSend = action !== "approve" && taskProgress(latest || task, snapshot).blockedSend;
  const originalTask = original.current;
  const message = result?.message?.id
    ? snapshot.messages.find((m: Row) => m.id === result.message.id) ||
      result.message
    : null;
  const replies = message
    ? snapshot.messages.filter(
        (m: Row) => m.replyTo === message.id && m.nativeItemId,
      )
    : [];
  const unavailable =
    action !== "approve" &&
    (!snapshot.connected ||
      !snapshot.authenticated ||
      !owner?.threadId ||
      !["idle", "active", "dispatching"].includes(owner.status));
  const stale =
    !result &&
    (latest?.updatedAt !== originalTask.updatedAt ||
      latest?.status !== originalTask.status ||
      owner?.revision !== originalBinding.current);
  const frozen = !!payload.current;
  const effect =
    action === "approve"
      ? "将此任务登记为制作人验收通过，不发送执行指令，不证明所有外部证据已经由系统复验。"
      : action === "revise"
        ? "在原任务记录修改意见、保留本次交付快照，并向原负责人发送修订要求；任务先待处理，收到原生执行确认后再显示执行状态。"
        : action === "discuss"
          ? "向原负责人发送疑问，在同一个 Thread 中继续讨论；任务保持待验收，不自动通过。"
          : "向当前负责人原 Thread 发送一条与本任务关联的执行指令。不新建任务、不更换负责人；可能消耗模型额度。忙碌时排队，不能据请求记录宣称执行完成。";
  async function commit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (blockedSend && !payload.current) { setError("维护暂停或已有指令/执行待核对，未发送新指令。请查看任务进展说明。"); return; }
    if ((action !== "discuss" && !confirmed) || !comment.trim()) {
      setError("请填写意见或指令，并勾选核对确认。");
      return;
    }
    lock.current = true;
    setPending(true);
    setError("");
    const body = payload.current || {
      action,
      comment: comment.trim(),
      clientRequestId: key.current,
      expectedUpdatedAt: originalTask.updatedAt,
      expectedStatus: originalTask.status,
      bindingRevision: originalBinding.current,
      expectedDeliveryId: originalDelivery.current,
    };
    payload.current = body;
    try {
      localStorage.setItem(storageKey, JSON.stringify(body));
      setResult(await submit(body));
      localStorage.removeItem(storageKey);
    } catch (e: any) {
      if (e.status >= 400 && e.status < 500) {
        payload.current = null;
        localStorage.removeItem(storageKey);
        key.current = crypto.randomUUID();
        setConfirmed(false);
      }
      setError(String(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="task-modal-backdrop">
      <div
        className="task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-action-title"
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const nodes = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),textarea:not(:disabled),input:not(:disabled),summary",
              ) || [],
            ).filter((n) => n.getClientRects().length);
            const first = nodes[0],
              last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id="task-action-title" tabIndex={-1} ref={heading}>
          {taskActionNames[action]}
        </h2>
        <h3>{originalTask.title}</h3>
        <p>
          反馈对象：{task.owner === "planner" ? "主策划" : "主开发"} ·
          打开时状态：{stateName(originalTask.status)}
        </p>
        <details open={action !== "discuss"}>
          <summary>本次目标、交付和操作影响</summary>
          <p>任务目标：</p>
          <ReadableText text={originalTask.objective} />
          <p>当前交付：</p>
          <ReadableText text={originalTask.summary || "尚无交付总结"} />
          <Raw label="查看本次交付证据" value={originalTask.evidence || []} />
          <p className="operation-impact">{effect}</p>
          <p>
            执行范围：{snapshot.config.project}；仅当前授权范围，只读 /
            禁止权限提升（read-only / never）。正式 RRPG 未接入。
          </p>
          <p className="muted">
            理论分析、模拟测试、真实执行的证据须分别核对；此面板不会提升执行权限或补造验证结果。
          </p>
        </details>
        {unavailable && !result && (
          <p role="alert">
            负责人当前不可用，不能发新消息。请先恢复连接并核对原会话；可以用原提交标识核对已提交的请求。
          </p>
        )}
        {blockedSend && !result && <p role="status">维护暂停或已有指令/执行待处理；当前不重复派发。已有未知请求仍可用原标识核对。</p>}
        {stale && !frozen && !result && (
          <p role="alert">任务已变化，请关闭面板并刷新后重新核对。</p>
        )}
        {frozen && !result && !pending && (
          <p>
            此操作已提交过，内容与提交标识已保留。下面仅重试原请求以核对结果，不另建指令。
          </p>
        )}
        {!result ? (
          <form onSubmit={commit}>
            <label htmlFor="task-action-comment">
              {action === "discuss"
                ? "具体疑问"
                : action === "revise"
                  ? "修改意见"
                  : action === "approve"
                    ? "验收意见与通过范围"
                    : "本次执行指令"}
            </label>
            <textarea
              id="task-action-comment"
              value={comment}
              maxLength={20000}
              disabled={pending || frozen}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                action === "approve"
                  ? "明确本次通过的成果和验证范围，不扩展到未验收功能。"
                  : "填写本次要负责人处理的具体内容。"
              }
            />
            {action !== "discuss" && (
              <label className="confirm-operation">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={pending || frozen}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我已核对任务、负责人及上述影响
              </label>
            )}
            {pending && <p role="status">正在提交；请勿重复点击或关闭面板…</p>}
            {error && (
              <div role="alert">
                <p>
                  提交未确认：
                  {/[㐀-鿿]/.test(error)
                    ? error.replace(/^Error: /, "")
                    : errorSummary(error)}
                </p>
                <p>
                  {frozen
                    ? "请核对任务与消息记录。仅用原提交标识核对重试，禁止改写未知请求后盲目重发。"
                    : "后台已明确拒绝本次请求。请处理上述原因，再重新核对并提交；任务变化时需关闭面板重新打开。"}
                </p>
                <Raw label="查看提交错误" value={error} />
              </div>
            )}
            <div className="actions">
              <button type="button" disabled={pending} onClick={onClose}>
                {error ? "关闭并核对记录" : "取消"}
              </button>
              <button
                className="primary"
                disabled={
                  pending ||
                  (blockedSend && !frozen) ||
                  ((unavailable || stale) && !frozen) ||
                  !comment.trim() ||
                  (action !== "discuss" && !confirmed)
                }
              >
                {pending
                  ? "提交中…"
                  : frozen
                    ? "使用相同标识核对重试"
                    : error
                      ? "重新确认并提交"
                      : action === "approve"
                        ? "确认通过本次成果"
                        : "确认提交"}
              </button>
            </div>
          </form>
        ) : (
          <div className="operation-result" role="status">
            <p>
              {action === "approve"
                ? "已记录制作人验收通过。"
                : "意见或指令已持久记录；这不代表负责人已经执行完成。"}
            </p>
            <p>
              实际任务状态：{stateName(latest?.status || result.task.status)}{" "}
              {latest?.revisionPhase
                ? latest.status === "awaiting_acceptance"
                  ? "· 修订已提交，待验收"
                  : "· 已进入修订流程"
                : ""}
            </p>
            {message && (
              <>
                <p>处理进展：{stateName(message.delivery)}</p>
                {message.error && (
                  <>
                    <p>{errorSummary(message.error)}</p>
                    <Raw value={message.error} />
                  </>
                )}
                <p>
                  {replies.length
                    ? "负责人答复："
                    : "尚无可关联的负责人答复。可进入原会话等待或核对历史。"}
                </p>
                {replies.map((m: Row) => (
                  <p key={m.id} className="message-content">
                    {m.content}
                  </p>
                ))}
              </>
            )}
            <Raw label="查看本次操作凭据" value={result} />
            <div className="actions">
              <button onClick={onClose}>关闭</button>
              <button onClick={onChat}>查看原会话与回复</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
