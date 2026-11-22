import type {Store} from "../db.js";
import type {Row} from "../../shared/contracts.js";
// Recover review delivery only, never replay an execution or an ambiguous turn.
export class DshResultRecovery {
 constructor(private store:Store,private submit:(input:Row,sender:string,key:string)=>Row,private ready:()=>boolean,private clock=Date.now){}
 tick(){
  if(!this.ready())return;
  const messages=this.store.all("messages");
  for(const owner of ["developer","planner"]){
   const agent=this.store.get("agents",owner);
   if(agent?.status!=="idle"||!agent.threadId||agent.activeTurnId)continue;
   if(messages.some(m=>m.recipient===owner&&["recorded","dispatching","accepted","in_progress","queued_native","unknown"].includes(m.delivery)))continue;
   const failed=messages.filter(m=>m.sender==="dsh-executor"&&m.recipient===owner&&m.delivery==="failed"&&m.error?.codexErrorInfo==="usageLimitExceeded");
   const latest=failed.at(-1);if(!latest)continue;
   const at=Date.parse(latest.updatedAt||latest.createdAt);
   if(!Number.isFinite(at)||this.clock()-at<3600000)continue;
   // A later successful instruction already had the opportunity to review these results.
   if(messages.some(m=>m.recipient===owner&&m.delivery==="completed"&&Date.parse(m.createdAt)>at))continue;
   const key="dsh-quota-review:"+latest.id;
   if(this.store.get("settings",key))continue;
   const task=this.store.get("tasks",latest.taskId);
   if(!task||["completed","cancelled","awaiting_acceptance"].includes(task.status))continue;
   if(this.store.all("executions").some(e=>e.owner===owner&&["preparing","dispatching","running","verifying","cancelling","unknown"].includes(e.status)))continue;
   const receipt=this.submit({recipient:owner,taskId:latest.taskId,kind:"request",content:"系统结果续接核查：此前DSH结果通知因Codex额度不足失败，冷却后仅尝试本次核查，不是重新执行授权。请读取原任务最近执行结果及真实测试记录，核对已完成内容后继续原任务；禁止重复派发已完成或结果未知的操作。若仍无额度则保留失败，不循环重试。关联失败通知："+failed.slice(-5).map(m=>m.id).join("、")},"dsh-result-recovery",key);
   this.store.put("settings",{id:key,messageId:receipt.id,sourceMessageId:latest.id,attemptedAt:new Date(this.clock()).toISOString()});return;
  }
 }
}
