import {test,expect} from "@playwright/test";
test("completed goal separates historical blocks without changing records",async({page})=>{
 await page.route('**/api/snapshot',async route=>{const s=await(await route.fetch()).json();s.tasks=[{id:'done',owner:'developer',title:'本轮目标',status:'completed'},{id:'old',parentTaskId:'done',owner:'developer',title:'旧受阻尝试',status:'blocked'}];s.agents=s.agents.map((a:any)=>({...a,status:'idle',error:null,historyPartial:false}));s.executions=[];s.messages=[];s.deliveries=[];s.projectGoal=null;s.dsh={...s.dsh,maintenance:false};await route.fulfill({json:s});});
 await page.goto('/');await page.getByRole('button',{name:'工作台',exact:true}).click();
 await expect(page.getByText('已登记专业交付，当前无执行',{exact:true})).toBeVisible();
 await expect(page.getByText('当前没有执行，存在受阻任务',{exact:true})).toHaveCount(0);
 await expect(page.getByText('尚未单独登记当前阶段目标；工程配置请看设置，已有交付请看最近成果。')).toBeVisible();
 const section=page.locator('details').filter({has:page.locator('summary').getByText('已结束目标的遗留记录（1）',{exact:true})});
 await expect(section.getByText(/旧受阻尝试/)).not.toBeVisible();await section.locator('summary').click();await expect(section.getByText(/旧受阻尝试/)).toBeVisible();
});
