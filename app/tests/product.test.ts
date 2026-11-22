import { describe, it, expect } from "vitest";
import {
  contractSchema,
  deliverySchema,
  requireChecks,
  decodeDelivery,
  deliveryPrefix,
  taskPurpose,
  readyForProducer,
} from "../src/shared/product.js";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ReadableText, MessageBody } from "../src/web/presentation.js";
describe("产品合同与真实验证边界", () => {
  const task = {
    acceptance: "producer",
    contract: {
      requiredChecks: [{ id: "run", title: "真实运行", mode: "real" }],
    },
  };
  const d = {
    summary: "目标范围内的成果",
    scope: "独立实验",
    next: "等待指定产品判断",
    artifacts: [
      { title: "分析文档", kind: "text" as const, value: "实际文本" },
    ],
    review: {
      reason: "明确指定评审",
      question: "是否接受此范围",
      options: ["接受", "调整"],
      impact: "等待方向判断",
    },
    checks: [
      {
        id: "run",
        title: "真实运行",
        result: "passed" as const,
        mode: "real" as const,
        evidence: ["native:实际证据引用"],
      },
    ],
  };
  it("目标需要真实运行时不能用非空文字、理论、模拟或失败代替", () => {
    for (const v of [
      undefined,
      { checks: [] },
      { checks: [{ ...d.checks[0], mode: "analysis" }] },
      { checks: [{ ...d.checks[0], mode: "simulated" }] },
      { checks: [{ ...d.checks[0], result: "failed" }] },
      { checks: [{ ...d.checks[0], evidence: [] }] },
    ])
      expect(() => requireChecks(task, v)).toThrow("完成条件尚未满足");
    expect(() => requireChecks(task, d)).not.toThrow();
  });
  it("分析任务不被强制要求文件执行；缺评审材料不盲批", () => {
    expect(() =>
      requireChecks({ contract: contractSchema.parse({ kind: "analysis" }) }),
    ).not.toThrow();
    expect(readyForProducer(task)).toBe(false);
    expect(readyForProducer(task, d)).toBe(true);
  });
  it("旧工具字符串兼容结构化交付且拒绝多版本或非法字段", () => {
    expect(
      decodeDelivery({ evidence: [deliveryPrefix + JSON.stringify(d)] }),
    ).toEqual(deliverySchema.parse(d));
    expect(() =>
      decodeDelivery({ delivery: d, evidence: [deliveryPrefix + "{}"] }),
    ).toThrow();
    expect(() =>
      decodeDelivery({
        evidence: [deliveryPrefix + JSON.stringify({ ...d, approved: true })],
      }),
    ).toThrow();
  });
  it("来源只用可信分类；英文标题与汉字均不决定实验身份", () => {
    expect(taskPurpose({ id: "a", title: "Lab 测试 English" }, [])).toBe(
      "unknown",
    );
    expect(
      taskPurpose({ id: "a" }, [
        { taskId: "a", kind: "purpose", purpose: "lab" },
      ]),
    ).toBe("lab");
  });
  it("中文、长英文、路径和JSON按原文读取，不产生英文原文或自动翻译", () => {
    for (const text of [
      "正常中文正文",
      "D:/path/API.json",
      "An historical English natural-language message that exceeds the old threshold",
      '{"api":"native"}',
    ]) {
      const html = renderToStaticMarkup(
        React.createElement(ReadableText, { text }),
      );
      expect(html).not.toContain("查看英文原文");
      expect(html).not.toContain("<details");
    }
    expect(
      renderToStaticMarkup(
        React.createElement(MessageBody, {
          message: { nativeItemId: "i", content: '{"meaning":"原文"}' },
        }),
      ),
    ).not.toContain("技术数据");
  });
});
