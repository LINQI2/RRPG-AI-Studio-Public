import { test, expect } from "@playwright/test";
import { openTaskCard } from "./task-navigation.js";
async function api(page: any, route: string, data?: any, method = "POST") {
  const session = await (await page.request.get("/api/session")).json();
  const r = await page.request.fetch("/api/" + route, {
    method: data === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      "X-Studio-CSRF": session.csrf,
    },
    ...(data === undefined ? {} : { data }),
  });
  return { status: r.status(), body: await r.json() };
}
const delivery = {
  summary: "模拟：可读分析结论",
  scope: "仅模拟文案",
  next: "按文本范围判断",
  artifacts: [
    {
      title: "模拟方案",
      kind: "text",
      value: "A 强调目标，B 强调过程；这不是游戏原型。",
    },
  ],
  checks: [
    {
      id: "review",
      title: "说明自查",
      mode: "analysis",
      result: "passed",
      evidence: ["fixture:review"],
    },
  ],
  review: {
    reason: "测试中明确指定的产品判断",
    question: "偏好 A 还是 B？",
    options: ["A", "B"],
    impact: "等待文本范围选择",
  },
};
test("producer outcome flow: professional autonomy, required execution blocks, ready materials and readable history", async ({
  page,
}) => {
  await page.goto("/");
  const ordinary = (
    await api(page, "tasks", {
      title: "普通专业任务",
      objective: "文字分析",
      owner: "developer",
      acceptance: "autonomous",
      purpose: "product",
    })
  ).body;
  expect(
    (
      await api(
        page,
        "tasks/" + ordinary.id,
        {
          status: "completed",
          summary: "中文结论",
          evidence: ["fixture"],
          delivery: { ...delivery, summary: "中文专业成果" },
        },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  const real = (
    await api(page, "tasks", {
      title: "尚未执行的实现目标",
      objective: "实际运行",
      owner: "developer",
      acceptance: "autonomous",
      purpose: "product",
      contract: { kind: "implementation" },
    })
  ).body;
  expect(
    (
      await api(
        page,
        "tasks/" + real.id,
        {
          status: "completed",
          summary: "不能假称执行",
          evidence: ["非空日志"],
        },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "需要制作人关注" }),
  ).toBeVisible();
  await expect(
    page.locator(".decision").filter({ hasText: "普通专业任务" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "任务", exact: true }).click();
  const card = await openTaskCard(page, "普通专业任务");
  await expect(card).toContainText("中文专业成果");
  await expect(card).toContainText("分析 / 专业自查");
  await expect(card).toContainText("无需逐项人工批准");
  await expect(card).toContainText("下一步");
  await expect(
    card.getByRole("button", { name: "通过验收", exact: true }),
  ).toHaveCount(0);
  const human = (
    await api(page, "tasks", {
      title: "明确产品判断",
      objective: "选择展示方式",
      owner: "planner",
      acceptance: "producer",
      purpose: "product",
    })
  ).body;
  await api(
    page,
    "tasks/" + human.id,
    {
      status: "completed",
      summary: delivery.summary,
      evidence: ["fixture"],
      delivery,
    },
    "PATCH",
  );
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.getByRole("button", { name: "↻ 刷新" }).click();
  await expect(
    page.locator(".decision").filter({ hasText: "明确产品判断" }),
  ).toContainText("偏好 A 还是 B");
});

test("all seven input workflows use Studio panels; cancellation, blank input, failure and partial scan are visible", async ({
  page,
}) => {
  let inject = true;
  await page.route("**/api/snapshot", async (route) => {
    const r = await route.fetch(),
      s = await r.json();
    if (inject) {
      s.decisions.push({
        id: "panel-decision",
        audience: "producer",
        owner: "planner",
        status: "open",
        question: "模拟产品问题",
        facts: "模拟输入验收",
        options: ["A", "B"],
      });
      s.requests.push({
        id: "panel-request",
        owner: "planner",
        status: "open",
        questions: [{ id: "q", question: "模拟原生问题" }],
      });
      s.agents.find((a: any) => a.id === "planner").activeTurnId = "panel-turn";
    }
    await route.fulfill({ response: r, json: s });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "在原会话回答 ↗" }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("请填写所有必需内容");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "回答全部问题" }).click();
  await page.getByRole("textbox", { name: "模拟原生问题" }).fill("模拟答案");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("操作未完成");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "查看原生会话历史" }).click();
  await page.getByRole("button", { name: "调整执行方向", exact: true }).click();
  await page
    .getByRole("textbox", { name: "当前需要调整的内容" })
    .fill("模拟改向");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("专业诊断与恢复", { exact: true }).click();
  await page
    .getByRole("button", { name: "受控绑定 / 替换", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "已核实的原 Thread ID" })
    .fill("invalid-ui-fixture");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "设定原生 Goal", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "明确的持续目标" })
    .fill("模拟目标，仅取消");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.route("**/api/handoffs/scan", (r) =>
    r.fulfill({
      json: {
        imported: 0,
        errors: [{ file: "fixture.json", error: "Invalid fixture" }],
      },
    }),
  );
  await page.getByRole("button", { name: "扫描交接目录" }).click();
  await expect(page.getByRole("alert")).toContainText("操作未完成");
  await expect(page.getByText("已处理 0 项，另有 1 项失败。")).toBeVisible();
  const t = (
    await api(page, "tasks", {
      title: "手工记录面板",
      objective: "仅文本输入",
      owner: "developer",
      acceptance: "autonomous",
      purpose: "product",
    })
  ).body;
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "↻ 刷新" }).click();
  const card = await openTaskCard(page, "手工记录面板");
  await card.getByText("专业维护：特殊手工记录", { exact: true }).click();
  await card.getByRole("button", { name: "记录成果与证据" }).click();
  await page
    .getByRole("textbox", { name: "成果总结" })
    .fill("手工声明，不是独立复验");
  await page
    .getByRole("textbox", { name: "证据引用（每行一项）" })
    .fill("fixture:manual");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("实际状态：已完成");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  // Handoff review panel is enabled only on a recorded, notified fixture.
  await page.route("**/api/snapshot", async (route) => {
    const r = await route.fetch(),
      s = await r.json();
    s.handoffs.push({
      id: "panel-handoff",
      title: "模拟交接",
      status: "notified",
      fingerprint: "fixture",
    });
    await route.fulfill({ response: r, json: s });
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "↻ 刷新" }).click();
  await page.getByText("专业诊断与恢复", { exact: true }).click();
  await page
    .getByRole("button", { name: "记录审查并交给主开发" })
    .last()
    .click();
  await page.getByRole("textbox", { name: "实际审查结论" }).fill("模拟审查");
  await page.getByRole("textbox", { name: "审查证据引用" }).fill("fixture");
  await page.getByRole("button", { name: "取消", exact: true }).click();
});

test("600 tasks / 240 messages stay readable at narrow viewport and entry is remembered", async ({
  page,
}) => {
  await page.route("**/api/snapshot", async (route) => {
    const r = await route.fetch(),
      s = await r.json();
    s.tasks = Array.from({ length: 600 }, (_, i) => ({
      id: "load-task-" + i,
      title: "规模样本 " + i,
      objective: "长历史验证，不是游戏成果",
      owner: "planner",
      status: "pending",
      acceptance: "autonomous",
      purpose: "product",
      evidence: [],
      messages: [],
    }));
    s.messages = Array.from({ length: 240 }, (_, i) => ({
      id: "load-message-" + i,
      sender: "producer",
      recipient: "planner",
      content: "中文消息样本 " + i,
      delivery: "completed",
    }));
    await route.fulfill({ response: r, json: s });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.locator(".task-card")).toHaveCount(30);
  await page.getByRole("button", { name: "加载更多任务记录" }).click();
  await expect(page.locator(".task-card")).toHaveCount(60);
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(page.locator(".message")).toHaveCount(80);
  await page.getByRole("button", { name: /加载更早消息/ }).click();
  await expect(page.locator(".message")).toHaveCount(160);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "把问题交给对的人。" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "runtime/screenshots/revision-narrow.png",
    fullPage: true,
  });
});
test("safe document references open readable text; prototype and unsafe references are never executable previews", async ({
  page,
}) => {
  await page.goto("/");
  const t = (
    await api(page, "tasks", {
      title: "文档预览范围",
      objective: "只读实验文档",
      owner: "developer",
      acceptance: "autonomous",
      purpose: "product",
    })
  ).body;
  await api(
    page,
    "tasks/" + t.id,
    {
      status: "completed",
      summary: "明确的只读文档入口",
      evidence: ["fixture:文档"],
      delivery: {
        summary: "明确的只读文档入口",
        scope: "固定 fixture 文本",
        next: "仅阅读",
        artifacts: [
          { title: "项目文档", kind: "project-file", value: "README.md" },
          {
            title: "不可确认的原型",
            kind: "prototype",
            value: "javascript:alert(1)",
          },
        ],
      },
    },
    "PATCH",
  );
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "↻ 刷新" }).click();
  const card = await openTaskCard(page, "文档预览范围");
  await card.getByText("阅读完整成果、验证与反馈", { exact: true }).click();
  await expect(card).toContainText("原型入口尚未安全核验");
  await card.getByRole("button", { name: "查看项目文档", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("只读文本预览");
  await expect(page.getByRole("dialog")).toContainText("项目");
  expect(await page.getByRole("dialog").locator("a").count()).toBe(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  expect(
    (await api(page, "artifact?path=../runtime/codex-home/auth.json")).status,
  ).not.toBe(200);
});
