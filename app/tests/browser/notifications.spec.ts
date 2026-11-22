import {test,expect} from "@playwright/test";
test("technical requests stay folded; producer unread, sound opt-in, permission denial and deduped toast reflect real source records",async({page})=>{
 let added=0,writes=0;
 page.on('request',r=>{if(r.method()==='POST')writes++;});
 await page.addInitScript(()=>{
   (window as any).__sounds=0;(window as any).__permissions=0;
   (window as any).AudioContext=class {state='running';currentTime=0;destination={};async resume(){}async close(){}createGain(){return {gain:{setValueAtTime(){}},connect(){}};}createOscillator(){return {frequency:{value:0},connect(){},start(){(window as any).__sounds++;},stop(){}};}};
   (window as any).Notification=class {static permission='denied';static async requestPermission(){(window as any).__permissions++;return 'denied';}};
 });
 await page.route('**/api/snapshot',async route=>{
   const s=await(await route.fetch()).json();s.tasks=[];s.deliveries=[];s.messages=[];s.requests=[];
   s.decisions=[{id:'technical',owner:'developer',audience:'technical',status:'open',question:'TECHNICAL_RECOVERY_TEXT',facts:'RAW_LOGS',options:['核查原生状态'],createdAt:'2026-10-24T01:00:00Z'},...Array.from({length:added+1},(_,i)=>({id:`product-${i}`,owner:'developer',audience:'producer',status:'open',question:`是否采用方案${i}`,facts:'产品方向依据',options:['采用','调整'],createdAt:new Date(Date.UTC(2026,9,24,2,i)).toISOString()}))];
   await route.fulfill({json:s});
 });
 await page.goto('/');await page.getByRole('button',{name:'工作台',exact:true}).click();
 const attention=page.locator('#producer-attention');
 await expect(attention.getByText('是否采用方案0',{exact:true})).toBeVisible();
 await expect(attention.getByText('TECHNICAL_RECOVERY_TEXT',{exact:true})).not.toBeVisible();
 await attention.getByText('技术协助与维护记录（1）',{exact:true}).click();
 await attention.getByText('查看求助内容与技术依据',{exact:true}).click();
 await expect(attention.getByText('TECHNICAL_RECOVERY_TEXT',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__permissions)).toBe(0);
 await page.getByRole('button',{name:'通知，1条未读',exact:true}).click();
 const panel=page.getByLabel('消息通知',{exact:true});
 await panel.getByRole('button',{name:'开启声音提醒',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__sounds)).toBe(1);
 await panel.getByRole('button',{name:'开启系统通知',exact:true}).click();
 await expect(panel).toContainText('系统通知未获允许');
 await panel.getByRole('button',{name:'标记当前通知已读',exact:true}).click();
 await expect(page.getByRole('button',{name:'通知，0条未读',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'关闭通知',exact:true}).click();
 added=1;await page.getByRole('button',{name:'↻ 刷新',exact:true}).click();
 await expect(page.getByRole('button',{name:'通知，1条未读',exact:true})).toBeVisible();
 await expect(page.locator('.notification-toast')).toContainText('主开发需要你作出决定');
 await expect.poll(()=>page.evaluate(()=>(window as any).__sounds)).toBe(2);
 await page.getByRole('button',{name:'↻ 刷新',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__sounds)).toBe(2);
  await page.getByRole('button',{name:'通知，1条未读',exact:true}).click();
 await panel.locator('.notification-item').first().getByRole('button',{name:'查看此项',exact:true}).click();
 await expect(page.getByRole('button',{name:'通知，0条未读',exact:true})).toBeVisible();
 await expect(attention.getByText('是否采用方案1',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'通知，0条未读',exact:true})).toBeVisible();
 added=2;await page.reload();await expect(page.getByRole('button',{name:'通知，1条未读',exact:true})).toBeVisible();
 expect(writes).toBe(0); // read state is never approval, task mutation or model dispatch
});
