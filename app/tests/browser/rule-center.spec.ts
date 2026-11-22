import { test, expect, type Page } from "@playwright/test";

function catalog() {
  return {
    root: "D:\\Studio\\rules",
    roles: ["planner", "developer", "dsh"].map(id => ({
      id,
      title: { planner: "主策划", developer: "主开发", dsh: "DSH 执行层" }[id],
      baseText: `完整基础规则：${id}。默认简体中文，不扩大执行权限。`,
      basePath: `D:\\Studio\\rules\\roles\\${id}.md`,
      supplement: "原有工作偏好",
      supplementPath: id === "dsh" ? null : `D:\\Studio\\rules\\preferences\\${id}.md`,
      revision: "revision-1", baseVersion: "fixture-version", effectiveHash: "current",
      appliedHash: "old", appliedAt: "2026-10-24T01:00:00.000Z",
      turnActive: id === "developer", applicationStatus: "pending", editable: id !== "dsh",
    })),
    skills: [{ title: "技能目录说明", description: "按需阅读专业方法。", path: "rules/skills/README.md", content: "技能正文：需要实际记录证明加载。", loaded: false }],
    harness: [{ title: "测试反馈与恢复", description: "由程序控制并发和恢复。", source: "app/src/server/unity/connection.ts" }],
    harnessGuide: { path: "rules/harness/README.md", content: "执行机制正文：程序限制不同于模型提示。" },
  };
}

async function openRules(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 规则与技能", exact: true })).toBeVisible();
  return page.locator(".rule-center");
}

test("rule center reads complete roles, skills and harness without model dispatch; DSH remains read-only", async ({ page }) => {
  const data = catalog();
  let writes = 0;
  page.on("request", request => { if (["POST", "PUT", "PATCH"].includes(request.method())) writes++; });
  await page.route("**/api/rules", route => route.fulfill({ json: data }));
  const center = await openRules(page);
  await expect(center.getByLabel("主策划基础规则", { exact: true })).toHaveValue(data.roles[0].baseText);
  await expect(center).toContainText("当前版本尚未记录加载");
  await center.getByRole("button", { name: "主开发", exact: true }).click();
  await expect(center).toContainText("负责人正在工作，本次保存不打断当前工作");
  await expect(center.getByLabel("主开发基础规则", { exact: true })).toHaveValue(data.roles[1].baseText);
  await center.getByText("文件位置与加载记录", { exact: true }).click();
  await expect(center).toContainText(data.roles[1].basePath);
  await center.getByRole("button", { name: "DSH 执行层", exact: true }).click();
  await expect(center.getByRole("button", { name: "保存补充规则", exact: true })).toHaveCount(0);
  await center.getByRole("button", { name: "操作技能", exact: true }).click();
  await expect(center).toContainText("技能正文：需要实际记录证明加载。");
  await expect(center).toContainText("未证实自动加载");
  await center.getByRole("button", { name: "执行机制", exact: true }).click();
  await expect(center).toContainText("执行机制正文：程序限制不同于模型提示。");
  await expect(center).toContainText("由程序控制并发和恢复");
  expect(writes).toBe(0);
});

test("role supplement saves once, reads back, waits for next turn and can be cleared without touching base rules", async ({ page }) => {
  const data = catalog();
  let saves = 0, modelCalls = 0;
  page.on("request", request => { if (request.method() === "POST" && /\/(messages|dispatch|turns)(\/|$)/.test(new URL(request.url()).pathname)) modelCalls++; });
  await page.route("**/api/rules", route => route.fulfill({ json: data }));
  await page.route("**/api/rules/planner", async route => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    expect(body.expectedRevision).toBe(data.roles[0].revision);
    saves++;
    data.roles[0].supplement = body.content;
    data.roles[0].revision = `revision-${saves + 1}`;
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ json: data });
  });
  const center = await openRules(page);
  const editor = center.getByLabel("主策划补充规则", { exact: true });
  await editor.fill("汇报先给结论，再说明影响。");
  await center.getByRole("button", { name: "保存补充规则", exact: true }).click({ clickCount: 2 });
  await expect(center).toContainText("补充规则已保存并回读核对");
  await expect(center).toContainText("下次正常对话加载");
  expect(saves).toBe(1);
  await expect(center.getByLabel("主策划基础规则", { exact: true })).toHaveValue(data.roles[0].baseText);
  await editor.fill("临时草稿");
  await center.getByRole("button", { name: "撤销未保存修改", exact: true }).click();
  await expect(editor).toHaveValue("汇报先给结论，再说明影响。");
  expect(saves).toBe(1);
  await editor.fill("");
  await center.getByRole("button", { name: "保存补充规则", exact: true }).click();
  await expect(center).toContainText("补充规则已保存并回读核对");
  expect(saves).toBe(2);
  expect(data.roles[0].supplement).toBe("");
  expect(modelCalls).toBe(0);
});

test("conflict and backend failure preserve supplement draft, require read-back and do not claim success", async ({ page }) => {
  const data = catalog();
  let attempt = 0;
  await page.route("**/api/rules", route => route.fulfill({ json: data }));
  await page.route("**/api/rules/developer", async route => {
    attempt++;
    if (attempt === 1) {
      data.roles[1].supplement = "另一位操作者已保存的内容";
      data.roles[1].revision = "revision-concurrent";
      await route.fulfill({ status: 409, json: { error: "规则已更新" } });
    } else await route.fulfill({ status: 500, json: { error: "fixture: write failure" } });
  });
  const center = await openRules(page);
  await center.getByRole("button", { name: "主开发", exact: true }).click();
  const editor = center.getByLabel("主开发补充规则", { exact: true });
  await editor.fill("我的未保存草稿");
  await center.getByRole("button", { name: "保存补充规则", exact: true }).click();
  await expect(center.getByRole("alert")).toContainText("本次没有覆盖");
  await expect(editor).toHaveValue("我的未保存草稿");
  await expect(center.getByRole("button", { name: "保存补充规则", exact: true })).toBeDisabled();
  await center.getByRole("button", { name: "读取最新规则，保留草稿", exact: true }).click();
  await expect(center).toContainText("另一位操作者已保存的内容");
  await expect(editor).toHaveValue("我的未保存草稿");
  await editor.fill("已合并最新内容的草稿");
  await center.getByRole("button", { name: "保存补充规则", exact: true }).click();
  await expect(center.getByRole("alert")).toContainText("未能确认保存结果");
  await expect(editor).toHaveValue("已合并最新内容的草稿");
  await expect(center.getByText("补充规则已保存并回读核对", { exact: false })).toHaveCount(0);
  expect(attempt).toBe(2);
});

test("isolated real rules API persists supplement after refresh, clears it and keeps base rules and threads unchanged", async ({ page }) => {
  let modelRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && /\/(messages|dispatch|turns|restore|initialize)(\/|$)/.test(new URL(request.url()).pathname)) modelRequests++;
  });
  let center = await openRules(page);
  await expect(center.getByLabel("主策划基础规则", { exact: true })).toBeVisible();
  const before = await (await page.request.get("/api/rules")).json();
  const agentBefore = await (await page.request.get("/api/snapshot")).json();
  await center.getByRole("button", { name: "主开发", exact: true }).click();
  const text = "仅隔离浏览器夹具：汇报先给中文结论，不启动模型。";
  await center.getByLabel("主开发补充规则", { exact: true }).fill(text);
  await center.getByRole("button", { name: "保存补充规则", exact: true }).click();
  await expect(center).toContainText("补充规则已保存并回读核对");
  await page.reload();
  center = page.locator(".rule-center");
  await expect(center).toBeVisible();
  await center.getByRole("button", { name: "主开发", exact: true }).click();
  await expect(center.getByLabel("主开发补充规则", { exact: true })).toHaveValue(text);
  const saved = await (await page.request.get("/api/rules")).json();
  expect(saved.roles.find((role: any) => role.id === "developer").supplement).toBe(text);
  await center.getByLabel("主开发补充规则", { exact: true }).fill("");
  await center.getByRole("button", { name: "保存补充规则", exact: true }).click();
  await expect(center).toContainText("补充规则已保存并回读核对");
  const after = await (await page.request.get("/api/rules")).json();
  for (const original of before.roles) {
    expect(after.roles.find((role: any) => role.id === original.id).baseText).toBe(original.baseText);
  }
  expect(after.roles.find((role: any) => role.id === "developer").supplement).toBe("");
  const agentAfter = await (await page.request.get("/api/snapshot")).json();
  expect(agentAfter.agents.map((agent: any) => ({ id: agent.id, threadId: agent.threadId }))).toEqual(agentBefore.agents.map((agent: any) => ({ id: agent.id, threadId: agent.threadId })));
  expect(modelRequests).toBe(0);
});

test('developer protocol is accessible separately from readable role',async({page})=>{
 const center=await openRules(page);await center.getByRole('button',{name:'主开发',exact:true}).click();
 await expect(center.getByLabel('主开发基础规则')).not.toHaveValue(/studio:dsh:v1:/);
 const detail=center.getByText('工具协议与执行边界（随对话提供）',{exact:true}).locator('..');
 await expect(detail.locator('pre')).toBeHidden();await detail.locator('summary').click();await expect(detail.locator('pre')).toContainText('studio:dsh:v1:');
});

test('planner responsibilities and protocol are separate and readable',async({page})=>{
 const center=await openRules(page);
 await expect(center.getByLabel('主策划基础规则')).toHaveValue(/你对游戏设计质量负责/);
 await expect(center.getByLabel('主策划基础规则')).not.toHaveValue(/studio_request_decision/);
 const detail=center.getByText('工具协议与执行边界（随对话提供）',{exact:true}).locator('..');
 await expect(detail.locator('pre')).toBeHidden();await detail.locator('summary').click();
 await expect(detail.locator('pre')).toContainText('studio_request_decision');
});
