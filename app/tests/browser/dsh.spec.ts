import { test, expect } from "@playwright/test";
import { expandDisclosure, openTaskCard, openTaskRegistration } from "./task-navigation.js";
test("transient snapshot failure clears after successful resync without reporting execution success", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("后台已连接", { exact: false }).first(),
  ).toBeVisible();
  await page.route("**/api/snapshot", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect(
    page.getByText("工作台同步暂未完成", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/snapshot");
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect(
    page.getByText("工作台同步暂未完成", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await openTaskRegistration(page);
  await page.route("**/api/tasks", (route) =>
    route.fulfill({ status: 500, json: { error: "human-operation-failed" } }),
  );
  await page.getByLabel("任务标题").fill("模拟：保留操作失败");
  await page.getByLabel("任务目标").fill("只检查错误提示，不创建模型任务");
  await page.getByRole("button", { name: "登记任务", exact: true }).click();
  const error = page.getByRole("alert").filter({ hasText: "操作未完成" });
  await expect(error).toBeVisible();
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect(error).toBeVisible();
});
test("DSH registration, scoped confirmation, cancellation and truthful disabled state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await openTaskRegistration(page, true);
  await page.getByLabel("任务标题").fill("DSH 浏览器独立实验");
  await page.getByLabel("任务目标").fill("仅独立 Lab 文件，不操作正式游戏");
  await page.getByLabel("指定负责人").selectOption("developer");
  await page.getByLabel("执行方式").selectOption("dsh");
  await page.getByLabel("任务用途").selectOption("product");
  await page.getByRole("button", { name: "登记任务", exact: true }).click();

  const card = await openTaskCard(page, "DSH 浏览器独立实验");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "发送首次执行指令" }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "提交 DSH 执行", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "提交 DSH 执行" });
  await expect(dialog).toContainText("不会写入正式 RRPG");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await card
    .getByRole("button", { name: "提交 DSH 执行", exact: true })
    .click();
  await dialog.getByRole("textbox").fill("");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(dialog).toContainText("填写所有必需内容");
  await dialog.getByRole("textbox").fill("明确目标与验证范围");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(dialog).toContainText("阻塞");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await card.getByRole("button",{name:"展开执行记录",exact:true}).click();
  await expect(card).toContainText("尚未启用");
  await expect(
    card.getByRole("button", { name: "提交 DSH 执行", exact: true }),
  ).toBeDisabled();
  await page.reload();

  await openTaskCard(page, "DSH 浏览器独立实验");
  await card.getByRole("button",{name:"展开执行记录",exact:true}).click();
  await expect(card).toContainText("不会自动完成");
});

test("managed Shell confirmation and stop remain explicit; protocol UI fixture is not real execution", async ({
  page,
}) => {
  let job: any,
    submitted: any,
    stopped = false;
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch(),
      s = await response.json();
    s.dsh = { ...s.dsh, managedShell: true };
    if (job) s.executions = [...s.executions, job];
    await route.fulfill({ response, json: s });
  });
  await page.route("**/api/tasks/*/executions", async (route) => {
    submitted = route.request().postDataJSON();
    job = {
      id: "ui-protocol-managed",
      taskId: route.request().url().split("/").at(-2),
      status: "running",
      shellMode: "managed",
      permissionState: "ready",
      executionSource: "simulated",
      summary: "协议UI fixture，未运行模型或修改ACL",
      stages: [
        { id: "inspect", title: "核对既有成果", state: "completed", checkpoint: { note: "仅核验文件存在与指纹，不代表测试通过" } },
        { id: "implement", title: "实现与测试", state: "running" },
        { id: "review", title: "回归交付", state: "pending" },
      ],
    };
    await route.fulfill({ status: 202, json: job });
  });
  await page.route(
    "**/api/executions/ui-protocol-managed/stop",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({ kind: "cancel" });
      stopped = true;
      job = { ...job, status: "cancelled", permissionState: "released" };
      await route.fulfill({ json: job });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await openTaskRegistration(page, true);
  await page.getByLabel("任务标题").fill("模拟：目录授权交互");
  await page.getByLabel("任务目标").fill("仅验证界面，不能算真实执行");
  await page.getByLabel("执行方式").selectOption("dsh");
  await page.getByLabel("任务用途").selectOption("product");
  await page.getByRole("button", { name: "登记任务", exact: true }).click();

  const card = await openTaskCard(page, "模拟：目录授权交互");
  await card
    .getByRole("button", { name: "提交 DSH 执行", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "提交 DSH 执行" });
  await expect(dialog.getByLabel("本次执行方式")).toHaveValue("disabled");
  await dialog.getByLabel("本次执行方式").selectOption("managed");
  await expect(dialog).toContainText("全局 Shell 关闭");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect(submitted.shellMode).toBe("managed");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await card.getByRole("button",{name:"展开执行记录",exact:true}).click();
  await expect(card).toContainText("尚未确认回收");
  const progress = card.getByRole("list", { name: "执行阶段进度" });
  await expect(progress).toContainText("核对既有成果：阶段已结束");
  await expect(progress).toContainText("不代表测试通过");
  await expect(progress).toContainText("实现与测试：执行中");
  await expect(progress).toContainText("回归交付：尚未开始");
  await card.getByRole("button", { name: "停止本次执行", exact: true }).click();
  const stop = page.getByRole("dialog", { name: "停止本次 DSH 执行" });
  await stop.getByRole("button", { name: "取消", exact: true }).click();
  expect(stopped).toBe(false);
  await card.getByRole("button", { name: "停止本次执行", exact: true }).click();
  await stop.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(stop).toContainText("已取消");
  await stop.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(card).toContainText("本次目录临时权限已回收");
  expect(stopped).toBe(true);
});
