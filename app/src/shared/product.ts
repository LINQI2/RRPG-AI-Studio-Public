import { z } from "zod";
import { StudioError, type Row } from "./contracts.js";

export const contractSchema = z
  .object({
    kind: z.enum(["analysis", "design", "implementation"]).default("analysis"),
    scope: z
      .string()
      .max(4000)
      .default("授权工作目录；只读 / never；正式 RRPG 未接入"),
    requiredChecks: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          mode: z.enum(["real", "simulated", "analysis"]),
        }),
      )
      .max(30)
      .default([]),
    producerReason: z.string().max(4000).optional(),
  })
  .strict();
export const deliverySchema = z
  .object({
    summary: z.string().trim().min(1).max(20000),
    scope: z.string().trim().min(1).max(4000),
    changes: z.string().max(8000).default("未单独记录"),
    issues: z.string().max(8000).default("未提供；不代表没有问题"),
    next: z.string().trim().min(1).max(8000),
    artifacts: z
      .array(
        z
          .object({
            title: z.string().min(1),
            kind: z.enum(["text", "project-file", "prototype"]),
            value: z.string().min(1).max(40000),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    checks: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            result: z.enum([
              "passed",
              "failed",
              "partial",
              "blocked",
              "untested",
              "not_applicable",
            ]),
            mode: z.enum(["real", "simulated", "analysis", "unknown"]),
            evidence: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    review: z
      .object({
        reason: z.string().min(1),
        question: z.string().min(1),
        options: z.array(z.string().min(1)).min(1),
        impact: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export const deliveryPrefix = "studio:delivery:v1:";
export function decodeDelivery(data: Row) {
  const envelopes = (data.evidence || []).filter((x: string) =>
    x.startsWith(deliveryPrefix),
  );
  if (envelopes.length > 1 || (envelopes.length && data.delivery))
    throw new StudioError("请只提交一个交付版本");
  if (data.delivery) return deliverySchema.parse(data.delivery);
  if (envelopes.length)
    return deliverySchema.parse(
      JSON.parse(envelopes[0].slice(deliveryPrefix.length)),
    );
  return undefined;
}
export function requireChecks(task: Row, delivery?: Row) {
  for (const required of task.contract?.requiredChecks || []) {
    const check = delivery?.checks?.find((c: Row) => c.id === required.id);
    if (
      !check ||
      check.result !== "passed" ||
      check.mode !== required.mode ||
      !check.evidence?.length
    )
      throw new StudioError(
        `完成条件尚未满足：${required.title}。请如实记录失败、未测或阻塞，不能用完成状态替代验证。`,
        409,
      );
  }
}
export function readyForProducer(task: Row, delivery?: Row) {
  return (
    task.acceptance === "producer" &&
    !!delivery?.review &&
    !!delivery?.artifacts?.length &&
    !!delivery?.summary
  );
}
export const checkNames: Row = {
  passed: "通过",
  failed: "失败",
  partial: "部分通过",
  blocked: "环境阻塞",
  untested: "未验证",
  not_applicable: "不适用",
};
export const modeNames: Row = {
  real: "真实执行（提交者声明，证据可追溯）",
  simulated: "模拟测试",
  analysis: "分析 / 专业自查",
  unknown: "来源未核实",
};
export function taskPurpose(task: Row, annotations: Row[]) {
  return (
    annotations.find((a) => a.taskId === task.id && a.kind === "purpose")
      ?.purpose ||
    task.purpose ||
    "unknown"
  );
}
