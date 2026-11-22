import { test, expect } from "@playwright/test";

test("lead status is Chinese and UTC times display Beijing even in a Pacific browser",async({browser})=>{
 const context=await browser.newContext({timezoneId:"America/Los_Angeles"});
 const page=await context.newPage();
 try{
 await page.route("**/api/snapshot",async route=>{
   const data=await(await route.fetch()).json();
   data.agents=data.agents.map((a:any)=>({...a,status:"idle",updatedAt:"2026-10-24T05:36:08.633Z",lastObserved:"2026-10-24T05:36:08.635Z",instructionAppliedAt:"2026-10-24T05:31:44.619Z",instructionVersion:"internal-role-version",home:"PRIVATE_HOME_DO_NOT_SURFACE"}));
   data.executions=[{id:"partition-fixture",owner:"developer",taskId:"partition-fixture-task",status:"running",lastActivityAt:"2026-10-24T05:36:00Z"}];
   await route.fulfill({json:data});
 });
 await page.goto("/");await page.getByRole("button",{name:"工作台",exact:true}).click();
 const card=page.locator("article.card").filter({has:page.getByRole("heading",{name:"主开发",exact:true})});
 await expect(card).toContainText("2026/10/24 13:36:08");
 await expect(card).toContainText("北京时间");
 await expect(card.getByLabel("当前工作")).toContainText("DSH 正在执行 1 项工作");
 await expect(card.getByText("角色规则",{exact:true})).not.toBeVisible();
 await expect(card.getByText("协作工具",{exact:true})).not.toBeVisible();
 await card.getByText("维护诊断（通常无需查看）",{exact:true}).click();
 await expect(card.getByText("最近核对会话",{exact:true})).toBeVisible();
 await expect(card.getByText("长期会话",{exact:true})).toBeVisible();
 await expect(card.getByText("PRIVATE_HOME_DO_NOT_SURFACE",{exact:false})).not.toBeVisible();
 await card.getByText("技术维护：原始会话数据（可选）",{exact:true}).click();
 await expect(card.locator("pre")).toContainText("PRIVATE_HOME_DO_NOT_SURFACE");
 }finally{await context.close();}
});

test("task detail explains maintenance, folds technical instructions and prevents duplicate dispatch", async ({ page }) => {
  let taskWrites=0;
  page.on("request", r=>{if(r.method()==="POST" && /\/api\/(tasks|executions)/.test(r.url())) taskWrites++;});
  await page.route("**/api/snapshot", async route=>{
    const data=await(await route.fetch()).json();
    data.dsh={...data.dsh,maintenance:true};
    data.tasks=[{id:"readability-fixture",title:"集中管理功能",objective:"TECHNICAL_RAW_REQUIREMENTS",summary:"RAW_FONT_HASH_DIAGNOSTIC",owner:"developer",executor:"codex",purpose:"product",status:"pending",acceptance:"autonomous",messages:["queued-fixture"],updatedAt:"2026-10-24T04:34:38.592Z"}];
    data.messages=[{id:"queued-fixture",taskId:"readability-fixture",sender:"producer",recipient:"developer",content:"继续原任务",delivery:"recorded"}];
    data.executions=[];data.deliveries=[];data.annotations=[];data.runs=[];
    await route.fulfill({json:data});
  });
  await page.goto("/");
  await page.getByRole("button",{name:"任务",exact:true}).click();
  const card=page.locator(".task-card").filter({hasText:"集中管理功能"});
  await expect(card.getByLabel("任务时间记录")).toBeVisible();
  await expect(card.getByLabel("任务时间记录")).toContainText("首次执行：尚无实际开始记录");
  await expect(card.getByLabel("任务时间记录").locator("time")).toHaveAttribute("datetime","2026-10-24T04:34:38.592Z");
  await card.getByRole("button",{name:"查看详情",exact:true}).click();
  await expect(card.getByLabel("任务进展说明")).toContainText("维护暂停 · 指令尚未发送");
  await expect(card.getByLabel("任务进展说明")).toContainText("当前无需你操作");
  await expect(card.getByText("完整要求：TECHNICAL_RAW_REQUIREMENTS")).not.toBeVisible();
  await expect(card.getByText("负责人原始记录：RAW_FONT_HASH_DIAGNOSTIC")).not.toBeVisible();
  await expect(card.getByRole("button",{name:"继续已有任务",exact:true})).toBeDisabled();
  await expect(card.getByRole("button",{name:"进入负责人会话",exact:true})).toBeEnabled();
  await card.getByText("原始任务要求与负责人技术记录",{exact:true}).click();
  await expect(card.getByText("完整要求：TECHNICAL_RAW_REQUIREMENTS")).toBeVisible();
  await expect(card.getByText("负责人原始记录：RAW_FONT_HASH_DIAGNOSTIC")).toBeVisible();
  expect(taskWrites).toBe(0);
});
test("DSH activity time is readable, ages without new events, refreshes and does not invent missing history", async ({ page }) => {
  const now = new Date("2026-10-23T12:30:00.000Z");
  await page.clock.install({ time: now });
  let at: string | null = new Date(now.getTime() - 20000).toISOString();
  await page.route("**/api/snapshot", async route => {
    const data = await (await route.fetch()).json();
    data.tasks = [{ id: "activity-fixture", title: "执行活动时间回归", objective: "隔离UI测试", owner: "developer", executor: "dsh", purpose: "product", status: "running", acceptance: "autonomous", evidence: [], runs: [] }];
    data.executions = [{ id: "activity-execution", taskId: "activity-fixture", status: "running", lastActivityAt: at }];
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  const task = page.locator(".task-card").filter({ hasText: "执行活动时间回归" });
  await task.getByRole("button",{name:"查看详情",exact:true}).click();
  await task.getByRole("button",{name:"展开执行记录",exact:true}).click();
  const activity = task.locator("p").filter({ hasText: "最近执行活动：" });
  await expect(activity).toContainText("20 秒前");
  await expect(activity.locator("time")).toHaveAttribute("datetime", at!);
  await page.clock.runFor(20000);
  await expect(activity).toContainText("40 秒前");
  at = new Date(now.getTime() + 20000).toISOString();
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect(activity).toContainText("刚刚");
  await expect(activity.locator("time")).toHaveAttribute("datetime", at);
  at = null;
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect(activity).toContainText("尚无带时间的原生执行事件");
  await expect(activity.locator("time")).toHaveCount(0);
});
test("maintenance pause is visible rather than presenting idle leads as a running workflow", async ({ page }) => {
  await page.route("**/api/snapshot", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.dsh = { ...data.dsh, maintenance: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(page.getByText("工作台维护中：已暂停自动派发，现有任务、对话和成果保留。维护验收后再恢复研发。")).toBeVisible();
});
test("blank workspace discards stale browser history and never creates threads or tasks on load", async ({
  page,
}) => {
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") writes++;
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "studio-drafts",
      JSON.stringify({ developer: { text: "旧历史草稿" } }),
    );
    localStorage.setItem("studio-entry", "tasks");
    localStorage.setItem("studio-selected-task", "old-id");
  });
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch(),
      s = await response.json();
    for (const k of [
      "tasks",
      "messages",
      "runs",
      "items",
      "executions",
      "decisions",
      "requests",
      "handoffs",
      "events",
    ])
      s[k] = [];
    s.agents = s.agents.map((a: any) => ({
      ...a,
      threadId: null,
      status: "unbound",
    }));
    await route.fulfill({ response, json: s });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "研发，正在发生。" }),
  ).toBeVisible();
  await expect(page.getByText("旧历史草稿")).toHaveCount(0);
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.locator(".task-card")).toHaveCount(0);
  await expect(page.getByText("查看 Lab 历史", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(page.getByLabel("给负责人发消息")).toHaveValue("");
  expect(
    await page.evaluate(() => localStorage.getItem("studio-selected-task")),
  ).toBeNull();
  expect(writes).toBe(0);
});
test("Unity is manual and unconfigured by default; configured identity failures are visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "核对Unity连接" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Unity默认手动启动", { exact: false }),
  ).toBeVisible();
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch(),
      s = await response.json();
    s.project = { root: "C:/fixture/project" };
    await route.fulfill({ response, json: s });
  });
  await page.route("**/api/unity/check", (r) =>
    r.fulfill({ status: 409, json: { error: "工程身份不符，未执行测试" } }),
  );
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await page.getByRole("button", { name: "核对Unity连接" }).click();
  await expect(page.getByRole("alert")).toContainText("操作未完成");
});
