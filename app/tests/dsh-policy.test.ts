import { it, expect } from "vitest";
import { executionOptions } from "../src/server/dsh/policy.js";
import { leadInstructions } from "../src/server/codex/tools.js";
it("direct execution stays direct; task reasoning is explicit and bounded", () => {
  expect(executionOptions({ instruction: "兼容旧请求" })).toEqual({});
  expect(executionOptions({ reasoningEffort: "low", maxTokens: 8192 })).toEqual(
    { reasoningEffort: "low", maxTokens: 8192 },
  );
  expect(executionOptions({ maxTokens: 32768 })).toEqual({ maxTokens: 32768 });
  expect(executionOptions({ maxTokens: null })).toEqual({ maxTokens: null });
  expect(() => executionOptions({ maxTokens: 0 })).toThrow();
  expect(() => executionOptions({ maxTokens: Infinity })).toThrow();
  expect(() => executionOptions({ reasoningEffort: "invented" })).toThrow();
  expect(() => executionOptions({ stages: [] })).toThrow();
});
it("custom stages need unique identities and cannot inject arbitrary configuration", () => {
  const stage = { id: "analysis", title: "分析", instruction: "仅分析" };
  expect(executionOptions({ stages: [stage] }).stages).toEqual([stage]);
  expect(() => executionOptions({ stages: [stage, stage] })).toThrow("重复");
  expect(() =>
    executionOptions({ stages: [{ ...stage, profile: "full-access" }] }),
  ).toThrow();
  expect(() =>
    executionOptions({
      stages: [{ ...stage, check: { kind: "shell", command: "anything" } }],
    }),
  ).toThrow();
});
it('invalid stage identity is a definite pre-dispatch rejection, not an unknown model outcome',()=>{
  expect(()=>executionOptions({stages:[{id:'management-surface-simulation-equivalence',title:'对照',instruction:'只读'}]})).toThrow('未创建或派发执行');
  expect(executionOptions({stages:[{id:'surface-equivalence',title:'对照',instruction:'只读'}]}).stages?.[0].id).toBe('surface-equivalence');
});
it("developer owns technical orchestration, planner owns design consistency", () => {
  expect(leadInstructions("developer")).toContain("你对技术交付负责");
  expect(leadInstructions("planner")).toContain("你对游戏设计质量负责");
  expect(leadInstructions("developer")).toContain("不强制阶段或子Agent");
  expect(leadInstructions("developer")).toContain("默认省略 maxTokens");
  expect(leadInstructions("developer")).toContain("普通技术问题在既有授权内自主定位、修复和验证");
});
