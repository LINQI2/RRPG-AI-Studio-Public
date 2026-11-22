import { z } from "zod";
import { StudioError } from "../../shared/contracts.js";

export const stageSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, '阶段标识须为1—40位小写字母、数字或连字符，并以字母开头'),
    title: z.string().trim().min(1).max(120),
    instruction: z.string().trim().min(1).max(10000),
    check: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("artifact"),
            path: z.string().min(1).max(200),
          })
          .strict(),
        z
          .object({
            kind: z.literal("unity-tests"),
            mode: z.enum(["EditMode", "PlayMode"]),
            filter: z
              .object({
                testAssembly: z.string().max(200).optional(),
                testNamespace: z.string().max(200).optional(),
                testClass: z.string().max(200).optional(),
                testMethod: z.string().max(300).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();
export type ExecutionStage = z.infer<typeof stageSchema>;
export const executionOptionFields = {
  workspace: z.enum(['project', 'isolated']).optional(),
  reasoningEffort: z.enum(["off", "low", "high", "max"]).optional(),
  // Optional explicit per-response cap. Omitted/null delegates to DSH/model defaults.
  maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  stages: z.array(stageSchema).min(1).max(6).optional(),
};
const schema = z.object(executionOptionFields).strict();
export function executionOptions(input: Record<string, any>) {
  const parsed = schema.safeParse(
    Object.fromEntries(
      Object.keys(executionOptionFields)
        .filter((k) => input[k] !== undefined)
        .map((k) => [k, input[k]]),
    ),
  );
  if (!parsed.success) throw new StudioError(`DSH请求参数校验拒绝，未创建或派发执行；可修正参数后重新提交：${parsed.error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；')}`);
  const value = parsed.data;
  if (value.stages) {
    if (new Set(value.stages.map((s) => s.id)).size !== value.stages.length)
      throw new StudioError("阶段标识不能重复");
    if (value.stages.reduce((n, s) => n + s.instruction.length, 0) > 20000)
      throw new StudioError("阶段指令总长度超过限制");
  }
  return value;
}
export const executionRoleVersion = "2026-10-23-scoped-unity-saves";
