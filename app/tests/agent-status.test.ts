import {expect,test} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import React from "react";
import {AgentStatus,agentWork} from "../src/web/agent-status.js";
import {beijingTime} from "../src/web/beijing-time.js";

test('idle unfinished task with technical request explains maintenance instead of asking to continue',()=>{
 const snapshot={tasks:[{id:'a',owner:'developer',status:'running'}],decisions:[{taskId:'a',status:'open',audience:'technical'}]};
 expect(agentWork({id:'developer',status:'idle'},snapshot).state).toContain('等待技术问题处理');
 expect(agentWork({id:'developer',status:'idle'},snapshot).next).toContain('无需重复发送');
 expect(agentWork({id:'developer',status:'active'},snapshot).state).toBe('负责人正在处理请求');
});
test("UTC timestamps display Beijing time explicitly and invalid values stay missing",()=>{
 expect(beijingTime("2026-10-24T05:36:08.633Z")?.text).toBe("2026/10/24 13:36:08");
 expect(beijingTime(null)).toBeNull();expect(beijingTime("bad")).toBeNull();
});
test("readable agent information does not imply successful tests or verified role compliance",()=>{
 const html=renderToStaticMarkup(React.createElement(AgentStatus,{agent:{status:"active",threadId:"original",tools:true,updatedAt:"2026-10-24T05:36:08.633Z",instructionAppliedAt:"2026-10-24T05:31:44Z",historyPartial:false,error:null}}));
 expect(html).toContain("北京时间");expect(html).toContain("不代表研发测试全部通过");expect(html).toContain("已绑定原有会话");expect(html).toContain("不等于已验证每次回答都符合规则");expect(html).toContain("技术维护：原始会话数据（可选）");
});
test("idle lead with active delegated work is shown as working, rather than idle",()=>{
 const work=agentWork({id:"developer",status:"idle"},{executions:[{owner:"developer",status:"running",lastActivityAt:"2026-10-24T05:36:00Z"}]});
 expect(work.state).toBe("DSH 正在执行 1 项工作");expect(work.activity).toBe("2026-10-24T05:36:00Z");
});
test("maintenance and unknown outcomes stay visible; missing materials do not invent producer acceptance",()=>{
 expect(agentWork({id:"developer",status:"idle"},{executions:[{owner:"developer",status:"verifying"}]}).state).toBe("正在验证 1 项执行结果");
 expect(agentWork({id:"developer",status:"idle"},{dsh:{maintenance:true}}).state).toContain("维护暂停");
 expect(agentWork({id:"developer",status:"idle"},{executions:[{owner:"developer",status:"unknown"}]})).toMatchObject({state:"执行或投递结果待核对",alert:true,review:false});
 expect(agentWork({id:"developer",status:"idle",historyPartial:true},{}).alert).toBe(true);
});

test("closed goal leftovers do not block current work, but live uncertainty stays visible",()=>{
 const snapshot:any={tasks:[{id:"p",owner:"developer",status:"completed"},{id:"c",parentTaskId:"p",owner:"developer",status:"blocked"}],executions:[]};
 const a={id:"developer",status:"idle"};expect(agentWork(a,snapshot).state).toBe("已登记专业交付，当前无执行");expect(agentWork(a,snapshot).historical).toHaveLength(1);
 snapshot.executions=[{taskId:"c",owner:"developer",status:"unknown"}];expect(agentWork(a,snapshot).state).toBe("执行或投递结果待核对");expect(agentWork(a,snapshot).historical).toHaveLength(0);
 snapshot.executions=[];snapshot.tasks[0].status="running";expect(agentWork(a,snapshot).state).toContain("存在受阻任务");
});
