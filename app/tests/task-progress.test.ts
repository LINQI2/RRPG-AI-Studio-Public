import { expect, test } from "vitest";
import { taskProgress, taskTimes } from "../src/web/task-progress.js";
const task = {id:"t", owner:"developer", status:"pending"};
test("a parent's progress and duplicate protection include explicitly linked descendant execution only",()=>{
 const s={tasks:[task,{id:"child",parentTaskId:"t"}],executions:[{taskId:"child",status:"running"}]};
 expect(taskProgress(task,s)).toMatchObject({status:"下级任务 · DSH 执行中",active:true,blockedSend:true});
 expect(taskProgress({...task,id:"unrelated"},s).active).toBe(false);
});
test("task timestamps distinguish registration, first native execution, record changes and actual work", () => {
  const result=taskTimes({...task,createdAt:"2026-10-22T01:00:00Z",updatedAt:"2026-10-22T02:00:00Z",runs:["run"]},{runs:[{id:"run",startedAt:1792634400,lastObserved:"2026-10-24T10:00:00Z"}],executions:[{taskId:"t",startedAt:"2026-10-23T01:00:00Z",updatedAt:"2026-10-24T02:00:00Z",lastActivityAt:"2026-10-24T01:59:00Z"},{taskId:"other",startedAt:"2020-01-01T00:00:00Z",lastActivityAt:"2030-01-01T00:00:00Z"}]});
  expect(result).toEqual({created:"2026-10-22T01:00:00.000Z",started:new Date(1792634400000).toISOString(),updated:"2026-10-24T02:00:00.000Z",activity:"2026-10-24T01:59:00.000Z"});
});
test("missing start cannot be invented from task creation or browser refresh", () => {
  expect(taskTimes({...task,createdAt:"2026-10-22T01:00:00Z",updatedAt:"bad"},{})).toMatchObject({started:null,updated:null,activity:null});
});
test("maintenance explains a queued continuation without changing task state", () => {
  const s={dsh:{maintenance:true},messages:[{taskId:"t",delivery:"recorded"}]};
  expect(taskProgress(task,s)).toMatchObject({status:"维护暂停 · 指令尚未发送",blockedSend:true});
  expect(task.status).toBe("pending");
});
test("unknown work takes precedence over maintenance and cannot be resent", () => {
  expect(taskProgress(task,{dsh:{maintenance:true},executions:[{taskId:"t",status:"unknown"}]}).status).toContain("待核对");
});
test("real active work remains visible during dispatch maintenance", () => {
  expect(taskProgress(task,{dsh:{maintenance:true},executions:[{taskId:"t",status:"running"}]})).toMatchObject({status:"DSH 执行中",active:true});
});
test("unrelated executions and delivered messages do not imply active work", () => {
  expect(taskProgress(task,{messages:[{taskId:"t",delivery:"completed"}],executions:[{taskId:"other",status:"running"}]})).toMatchObject({active:false,blockedSend:false,status:"待安排 · 当前没有待发指令"});
});
test("completion does not become waiting merely because maintenance is active", () => {
  expect(taskProgress({...task,status:"completed"},{dsh:{maintenance:true}}).status).toBe("已登记完成");
});
test("professional verification does not automatically request producer acceptance", () => {
  expect(taskProgress({...task,status:"awaiting_acceptance",acceptance:"autonomous"},{}).action).toContain("不自动要求制作人批准");
  expect(taskProgress({...task,status:"awaiting_acceptance",acceptance:"producer"},{}).status).toBe("等待制作人验收");
});
