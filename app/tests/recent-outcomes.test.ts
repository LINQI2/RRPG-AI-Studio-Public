import {expect,test} from "vitest";
import {outcomeGroups,verificationSummary} from "../src/web/recent-outcomes.js";
test("child technical reports are grouped beneath an explicit goal without becoming the parent delivery",()=>{
 const tasks=[{id:"root",title:"目标",summary:"尚在推进"},{id:"child",parentTaskId:"root",title:"专项",summary:"诊断"}];
 const groups=outcomeGroups({tasks,deliveries:[{taskId:"child",summary:"真实阶段报告",createdAt:"2026-10-24T05:00:00Z"}]});
 expect(groups).toHaveLength(1);expect(groups[0].delivery).toBeUndefined();expect(groups[0].versions).toBe(1);expect(groups[0].reports[1].delivery.summary).toBe("真实阶段报告");
});
test("only the latest delivery per task is used, preserving old versions and sorting by actual recorded times",()=>{
 const groups=outcomeGroups({tasks:[{id:"a"},{id:"b"}],deliveries:[{taskId:"a",version:2,createdAt:"2026-10-24T05:00:00Z"},{taskId:"b",version:1,createdAt:"2026-10-24T06:00:00Z"},{taskId:"a",version:1,createdAt:"2026-10-23T05:00:00Z"}]});
 expect(groups.map(g=>g.root.id)).toEqual(["b","a"]);expect(groups[1].delivery.version).toBe(2);expect(groups[1].versions).toBe(2);
});
test("completed task and analysis-only, missing evidence or failed checks never imply real execution passed",()=>{
 const stats=verificationSummary({status:"completed",contract:{requiredChecks:[{id:"x",mode:"real"}]}},{checks:[{id:"x",mode:"analysis",result:"passed",evidence:["analysis"]},{id:"y",mode:"real",result:"passed",evidence:[]},{id:"z",mode:"real",result:"failed",evidence:["failure"]}]});
 expect(stats).toMatchObject({realPassed:0,nonReal:1,failed:1,unverified:1,missing:1});
});
test("unrelated similar titles are not merged and unreported tasks are not invented as outcomes",()=>{
 expect(outcomeGroups({tasks:[{id:"a",title:"same",summary:"one"},{id:"b",title:"same",summary:"two"},{id:"c",title:"new"}]})).toHaveLength(2);
});
