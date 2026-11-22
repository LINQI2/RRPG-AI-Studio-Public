import {test,expect} from "@playwright/test";
test("recent outcomes group the goal, separate missing full delivery from old technical reports and navigate to the real child",async({page})=>{
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
 await page.route('**/api/snapshot',async route=>{
   const s=await(await route.fetch()).json();
   const base={owner:'developer',executor:'codex',purpose:'product',acceptance:'autonomous',evidence:[],runs:[],messages:[],createdAt:'2026-10-22T01:00:00Z',updatedAt:'2026-10-24T05:00:00Z'};
   s.tasks=[{...base,id:'outcome-goal',title:'集中管理成果总目标',objective:'可查看和操作的管理功能',status:'running',summary:'CURRENT_TECHNICAL_DIAGNOSTIC'},{...base,id:'outcome-child',parentTaskId:'outcome-goal',title:'施工专项工作包',objective:'只验证本分项',status:'blocked',summary:'TECHNICAL_RAW_OLD_FAILURE'}];
   s.deliveries=[{id:'old-delivery',taskId:'outcome-child',version:1,createdAt:'2026-10-22T03:00:00Z',summary:'TECHNICAL_RAW_OLD_FAILURE',scope:'分项报告',next:'需要技术恢复',artifacts:[{title:'旧执行证据',kind:'text',value:'RAW_EXECUTION_ID'}],checks:[{id:'partial-check',result:'passed',mode:'analysis',evidence:['analysis-only']}]}];
   s.executions=[{id:'active-child',taskId:'outcome-child',owner:'developer',status:'running'}];
   s.messages=[];s.annotations=[];s.runs=[];s.dsh={...s.dsh,maintenance:false};
   await route.fulfill({json:s});
 });
 await page.goto('/');await page.getByRole('button',{name:'工作台',exact:true}).click();
 const panel=page.getByLabel('最近成果',{exact:true});
 await expect(panel.locator('.outcome-group')).toHaveCount(1);
 await expect(panel).toContainText('尚未提交本目标的完整成果');
 await expect(panel).toContainText('尚无总目标的完整验证结论');
 await expect(panel).toContainText('下级任务 · DSH 执行中');
 await expect(panel.getByText('TECHNICAL_RAW_OLD_FAILURE',{exact:true})).not.toBeVisible();
 await panel.getByText('分项进展与阶段报告（1 个下级任务）',{exact:true}).click();
 const child=panel.locator('.outcome-part').filter({has:page.getByRole('heading',{name:'分项：施工专项工作包',exact:true})});
 await expect(child).toBeVisible();
 await child.getByText('负责人原始报告与技术证据',{exact:true}).click();
 await expect(child.getByText('TECHNICAL_RAW_OLD_FAILURE',{exact:true})).toBeVisible();
 await child.getByRole('button',{name:'前往任务树查看此项',exact:true}).click();
 await expect(page.locator('[data-task-id="outcome-child"] .task-expanded')).toBeVisible();
 expect(writes).toBe(0);
});
