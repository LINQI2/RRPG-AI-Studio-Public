import React, { useEffect, useRef, useState } from "react";
import { Raw, errorSummary, stateName } from "./presentation.js";
export type InputSpec = {
  title: string;
  description: string;
  fields: {
    name: string;
    label: string;
    value?: string;
    options?: { value: string; label: string }[];
  }[];
  initialResult?: any;
  submit: (values: Record<string, string>) => Promise<any>;
};
export function InputPanel({
  spec,
  onClose,
}: {
  spec: InputSpec;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(spec.fields.map((f) => [f.name, f.value || ""])),
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>(spec.initialResult || null),
    [attempted, setAttempted] = useState(false);
  const lock = useRef(false),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    root.current?.querySelector<HTMLElement>("textarea,select,button")?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <div className="task-modal-backdrop">
      <div
        className="task-modal"
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) onClose();
          if (e.key === "Tab") {
            const nodes = Array.from(
              root.current!.querySelectorAll<HTMLElement>(
                "textarea:not(:disabled),select:not(:disabled),button:not(:disabled),summary",
              ),
            );
            if (e.shiftKey && document.activeElement === nodes[0]) {
              e.preventDefault();
              nodes.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
              e.preventDefault();
              nodes[0]?.focus();
            }
          }
        }}
      >
        <h2>{spec.title}</h2>
        <p className="operation-impact">{spec.description}</p>
        {result ? (
          <div role="status">
            <p>
              后台已返回记录。请查看实际状态；请求被接受不代表负责人工作完成。
            </p>
            {result.errors?.length > 0 && (
              <p role="alert">部分事项失败，请查看详情并处理。</p>
            )}
            {result.status && <p>实际状态：{stateName(result.status)}</p>}
            {result.summary && <p>{result.summary}</p>}
            {result.content && (
              <div className="message-content">{result.content}</div>
            )}
            <Raw label="查看实际操作结果" value={result} />
            <button onClick={onClose}>关闭</button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current || attempted) return;
              if (spec.fields.some((f) => !values[f.name]?.trim())) {
                setError("请填写所有必需内容。");
                return;
              }
              lock.current = true;
              setPending(true);
              setError("");
              try {
                setResult(await spec.submit(values));
              } catch (e: any) {
                setError(String(e));
                if (!e.status || e.status >= 500) setAttempted(true);
              } finally {
                lock.current = false;
                setPending(false);
              }
            }}
          >
            {spec.fields.map((f) => (
              <label key={f.name}>
                {f.label}
                {f.options ? (
                  <select
                    aria-label={f.label}
                    value={values[f.name]}
                    disabled={pending || attempted}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.name]: e.target.value }))
                    }
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    aria-label={f.label}
                    maxLength={20000}
                    value={values[f.name]}
                    disabled={pending || attempted}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.name]: e.target.value }))
                    }
                  />
                )}
              </label>
            ))}
            {pending && <p role="status">提交中，请勿重复操作…</p>}
            {error && (
              <div role="alert">
                <p>
                  {error.startsWith("Error: ") ? errorSummary(error) : error}
                </p>
                {attempted && (
                  <p>结果尚未确认。请关闭并核对记录，不自动重复发送。</p>
                )}
                <Raw label="查看错误记录" value={error} />
              </div>
            )}
            <div className="actions panel-actions">
              <button type="button" disabled={pending} onClick={onClose}>
                取消
              </button>
              <button className="primary" disabled={pending || attempted}>
                {pending ? "提交中…" : "确认提交"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
