import { test, expect, Page } from "@playwright/test";
import { openTaskCard, openTaskRegistration } from "./task-navigation.js";
async function api(page: Page, route: string, body: any, method = "POST") {
  const response = await page.request.get("/api/session");
  const session = await response.json();
  const r = await page.request.fetch("/api/" + route, {
    method,
    headers: {
      "X-Studio-CSRF": session.csrf,
      "Content-Type": "application/json",
    },
    data: body,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function fixtureTask(page: Page, title: string, delivered = true) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "研发，正在发生。" }),
  ).toBeVisible();
  const t = await api(page, "tasks", {
    title,
    objective: "独立 fixture 分析任务，不执行文件。",
    owner: "developer",
    acceptance: "producer",
  });
  if (delivered)
    await api(
      page,
      "tasks/" + t.id,
      {
        status: "completed",
        summary: "仅 fixture 理论结论；不是实机执行成果。",
        evidence: ["fixture:analysis-only"], delivery:{summary:"仅 fixture 理论结论；不是实机执行成果。",scope:"fixture 分析",next:"等待文本范围评审",artifacts:[{kind:"text",title:"分析结论",value:"不代表实机执行"}],review:{reason:"fixture 指定人工评审",question:"是否认可该文案范围？",options:["认可","调整"],impact:"等待本次范围判断"}},
      },
      "PATCH",
    );
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  return t;
}
async function open(page: Page, title: string, action: string) {
  await page
    .locator(".decision")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("button", { name: action, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function fill(page: Page, text: string) {
  await page.getByRole("dialog").getByRole("textbox").fill(text);
  if(await page.getByLabel("我已核对任务、负责人及上述影响").count()) await page.getByLabel("我已核对任务、负责人及上述影响").check();
}

test("acceptance cancel, empty input, double click, discussion reply and revision preserve same task", async ({
  page,
}) => {
  const title = "交互回归：验收反馈";
  const t = await fixtureTask(page, title);
  await open(page, title, "要求修改");
  await expect(page.getByRole("dialog")).toContainText("主开发");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await open(page, title, "继续讨论");
  await fill(page, "   ");
  await expect(
    page.getByRole("button", { name: "确认提交", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("请解释理论验证与文件执行的区别");
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(`/tasks/${t.id}/actions`)) requests++;
  });
  await page.getByRole("button", { name: "确认提交", exact: true }).dblclick();
  await expect(page.getByRole("dialog")).toContainText("意见或指令已持久记录");
  await expect(page.getByRole("dialog")).toContainText("待制作人验收");
  await expect(page.getByRole("dialog")).toContainText("FIXTURE ONLY");
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await open(page, title, "要求修改");
  await fill(page, "补充边界案例，保持原有证据。");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已进入修订流程");
  const snapshot = await page.request
    .get("/api/snapshot")
    .then((r) => r.json());
  const current = snapshot.tasks.find((a: any) => a.id === t.id);
  expect(current.evidence).toEqual(["fixture:analysis-only"]);
  expect(current.acceptanceHistory.map((a: any) => a.action)).toEqual([
    "discuss",
    "revise",
  ]);
  expect(
    snapshot.messages.filter(
      (m: any) => m.taskId === t.id && m.sender === "producer",
    ),
  ).toHaveLength(2);
  await page.screenshot({
    path: "runtime/producer-actions-20261016/fixture-revision.png",
    fullPage: true,
  });
});
test("backend error, submitting state and uncertain retry survive reload without a second command", async ({
  page,
}) => {
  const title = "交互回归：失败重试";
  const t = await fixtureTask(page, title);
  await open(page, title, "继续讨论");
  await fill(page, "失败回归问题");
  const bodies: any[] = [];
  let calls = 0;
  await page.route(`**/api/tasks/${t.id}/actions`, async (route) => {
    bodies.push(route.request().postDataJSON());
    calls++;
    await new Promise((r) => setTimeout(r, 350));
    if (calls === 1) {
      const committed = await route.fetch();
      expect(committed.ok()).toBeTruthy();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "受控模拟后台失败" }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "提交中…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("受控模拟后台失败");
  await page.reload();
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await open(page, title, "继续讨论");
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue(
    "失败回归问题",
  );
  await page
    .getByRole("button", { name: "使用相同标识核对重试", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("意见或指令已持久记录");
  expect(bodies[0]).toEqual(bodies[1]);
  const snapshot = await page.request
    .get("/api/snapshot")
    .then((r) => r.json());
  expect(
    snapshot.messages.filter(
      (m: any) => m.taskId === t.id && m.sender === "producer",
    ),
  ).toHaveLength(1);
});
test("unavailable owner prevents submission and approval clearly records its limited scope", async ({
  page,
}) => {
  const title = "交互回归：不可用";
  const t = await fixtureTask(page, title);
  await page.route("**/api/snapshot", async (route) => {
    const r = await route.fetch();
    const s = await r.json();
    s.agents.find((a: any) => a.id === "developer").status = "unknown";
    await route.fulfill({ response: r, json: s });
  });
  await page.reload();
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await open(page, title, "要求修改");
  await fill(page, "不可用时禁止发送");
  await expect(page.getByRole("dialog")).toContainText("负责人当前不可用");
  await expect(
    page.getByRole("button", { name: "确认提交", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await open(page, title, "通过验收");
  await expect(page.getByRole("dialog")).toContainText(
    "不证明所有外部证据已经由系统复验",
  );
  await fill(page, "仅通过 fixture 理论文案，不验收代码执行");
  await page
    .getByRole("button", { name: "确认通过本次成果", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("已记录制作人验收通过");
  const s = await page.request.get("/api/snapshot").then((r) => r.json());
  expect(s.tasks.find((a: any) => a.id === t.id).status).toBe("completed");
  expect(s.messages.some((m: any) => m.taskId === t.id)).toBeFalsy();
});
test("new task, first instruction, continuation and explicit re-execution have separate confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  const title = "交互回归：执行语义";
  await openTaskRegistration(page);
  await page.getByLabel("任务标题").fill(title);
  await page.getByLabel("任务目标").fill("仅 fixture 分析，不运行文件");
  await page.getByRole("button", { name: "登记任务", exact: true }).click();
  const card = await openTaskCard(page, title);
  await card
    .getByRole("button", { name: "发送首次执行指令", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "不新建任务、不更换负责人",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await card
    .getByRole("button", { name: "发送首次执行指令", exact: true })
    .click();
  await fill(page, "SLOW 只分析，不调用任何真实工具");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "不代表负责人已经执行完成",
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "继续已有任务", exact: true }),
  ).toBeVisible();
  await expect(card).toContainText("执行中");
  const s = await page.request.get("/api/snapshot").then((r) => r.json());
  const t = s.tasks.find((a: any) => a.title === title);
  await new Promise((r) => setTimeout(r, 1400));
  await card.getByRole("button", { name: "继续已有任务", exact: true }).click();
  await fill(page, "继续同一任务的文本分析");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("FIXTURE ONLY");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await api(
    page,
    "tasks/" + t.id,
    {
      status: "completed",
      summary: "fixture-only",
      evidence: ["fixture:result"],
    },
    "PATCH",
  );
  await page.getByRole("button", { name: "↻ 刷新" }).click();
  await card
    .getByRole("button", { name: "重新执行已结束任务", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("可能消耗模型额度");
  await fill(page, "明确重新执行同一 fixture 分析");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("FIXTURE ONLY");
  const final = await page.request.get("/api/snapshot").then((r) => r.json());
  expect(final.tasks.filter((a: any) => a.title === title)).toHaveLength(1);
  expect(
    final.tasks
      .find((a: any) => a.id === t.id)
      .actionHistory.map((a: any) => a.action),
  ).toEqual(["start", "continue", "resend"]);
});

test("explicit CSRF rejection refreshes session once with the same operation identity", async ({
  page,
}) => {
  const title = "交互回归：会话校验恢复";
  const t = await fixtureTask(page, title);
  await open(page, title, "继续讨论");
  await fill(page, "只测试会话校验恢复");
  await page.context().clearCookies();
  await page.request.get("/api/session");
  const bodies: any[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(`/tasks/${t.id}/actions`))
      bodies.push(r.postDataJSON());
  });
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("意见或指令已持久记录");
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  const snapshot = await page.request
    .get("/api/snapshot")
    .then((r) => r.json());
  expect(
    snapshot.messages.filter(
      (m: any) => m.taskId === t.id && m.sender === "producer",
    ),
  ).toHaveLength(1);
});
