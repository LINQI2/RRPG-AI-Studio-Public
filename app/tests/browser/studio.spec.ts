import { test, expect } from "@playwright/test";
import { openTaskCard, openTaskRegistration } from "./task-navigation.js";
test("four pages, task registry, messages, history and persistent draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "研发，正在发生。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "研发，正在发生。" }),
  ).toBeVisible();
  await page.screenshot({
    path: "runtime/screenshots/dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await openTaskRegistration(page);
  await page.getByLabel("任务标题").fill("浏览器验收工作包");
  await page
    .getByLabel("任务目标")
    .fill("验证真实页面交互和持久化，不调用模型");
  await page.getByRole("button", { name: "登记任务", exact: true }).click();
  const task = await openTaskCard(page, "浏览器验收工作包");
  await expect(task.locator(".task-summary-title")).toHaveText("浏览器验收工作包");
  await expect(task.locator(".task-summary-title")).toBeVisible();
  await expect(task.locator(".task-expanded")).toContainText(
    "验证真实页面交互和持久化，不调用模型",
  );
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByLabel("给负责人发消息").fill("draft before reload");
  await page.reload();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(page.getByLabel("给负责人发消息")).toHaveValue(
    "draft before reload",
  );
  await page.getByLabel("给负责人发消息").fill("EARLY_FINAL browser test");
  await page.getByRole("button", { name: "记录并发送" }).click();
  await expect(
    page
      .locator(".message.mine")
      .filter({ hasText: "EARLY_FINAL browser test" })
      .getByText("已完成", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".execution")).toHaveCount(0);
  await page.getByRole("button", { name: "查看原生会话历史" }).click();
  await page.getByRole("button", { name: "读取原生历史" }).click();
  await expect(page.locator(".execution .native-turn")).toHaveCount(1);
  await expect(page.locator(".native-turn")).not.toHaveAttribute("open", "");
  await page.locator(".native-turn > summary").click();
  await expect(page.locator(".execution")).toContainText("turn-");
  await page.screenshot({
    path: "runtime/screenshots/collaboration.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "主策划 ↔ 主开发", exact: true })
    .click();
  await expect(page.locator(".execution")).toContainText(
    "此视图没有第三个 Thread",
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("专业诊断与恢复",{exact:true}).click();
  await expect(
    page.getByRole("heading", { name: "原生能力状态" }),
  ).toBeVisible();
  await expect(page.getByText("项目接入需单独配置",{exact:false}).first()).toBeVisible();
  await page.screenshot({
    path: "runtime/screenshots/settings.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("closing all browser pages does not cancel accepted execution", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/");
  await p.getByRole("button", { name: "会话", exact: true }).click();
  await p.getByLabel("给负责人发消息").fill("SLOW close-browser test");
  await p.getByRole("button", { name: "记录并发送" }).click();
  await expect(
    p.locator(".message.mine").filter({ hasText: "SLOW close-browser test" }),
  ).toBeVisible();
  await ctx.close();
  await new Promise((r) => setTimeout(r, 1800));
  const next = await browser.newPage();
  await next.goto("/");
  await next.getByRole("button", { name: "会话", exact: true }).click();
  await expect(
    next
      .locator(".message.mine")
      .filter({ hasText: "SLOW close-browser test" })
      .getByText("已完成", { exact: true }),
  ).toBeVisible();
  await next.close();
});
test("SSE reconnect, API duplicate submission and cursor replay", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const sess = await fetch("/api/session").then((r) => r.json());
    const body = {
      recipient: "developer",
      content: "SSE replay nonce",
      clientRequestId: "browser-idempotency-1",
    };
    const send = () =>
      fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Studio-CSRF": sess.csrf,
        },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const [a, b] = await Promise.all([send(), send()]);
    return { a, b };
  });
  expect(result.a.id).toBe(result.b.id);
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "你 ↔ 主开发", exact: true }).click();
  await expect(
    page.locator(".message.mine").filter({ hasText: "SSE replay nonce" }),
  ).toHaveCount(1);
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "你 ↔ 主开发", exact: true }).click();
  await expect(
    page.locator(".message.mine").filter({ hasText: "SSE replay nonce" }),
  ).toHaveCount(1);
});

test("Chinese chat keeps raw data folded and native unknown types explicit", async ({
  page,
}) => {
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch();
    const s = await response.json();
    const planner = s.agents.find((a: any) => a.id === "planner");
    s.messages.push({
      id: "ui-fixture-json",
      sender: "planner",
      recipient: "producer",
      content: '{"marker":"UI_RAW_FIXTURE"}',
      nativeItemId: "ui-fixture-only",
      contentType: "technical",
      delivery: "observed_reply",
      createdAt: new Date().toISOString(),
      threadId: planner.threadId,
    });
    s.items.push({
      id: "ui-tool-fixture",
      threadId: planner.threadId,
      type: "futureNativeItem",
      status: "futureStatus",
    });
    await route.fulfill({ response, json: s });
  });
  await page.goto("/");
  await page.getByRole("button",{name:"会话",exact:true}).click();
  await expect(
    page.getByRole("heading", { name: "把问题交给对的人。" }),
  ).toBeVisible();
  await expect(page.locator(".execution")).toHaveCount(0);
  await expect(
    page.getByText("负责人返回了技术数据，原文已收起。"),
  ).toBeVisible();
  await expect(
    page.getByText('{"marker":"UI_RAW_FIXTURE"}', { exact: true }),
  ).toBeHidden();
  await page.getByText("查看消息原文", { exact: true }).click();
  await expect(
    page.getByText('{"marker":"UI_RAW_FIXTURE"}', { exact: true }),
  ).toBeVisible();
  await page
    .locator(".chat-technical > summary")
    .click();
  await expect(
    page.getByText(/未识别的原生记录：futureNativeItem/),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看原生会话历史" }).click();
  await expect(
    page.getByRole("heading", { name: "完整原生 Thread 历史" }),
  ).toBeVisible();
});
