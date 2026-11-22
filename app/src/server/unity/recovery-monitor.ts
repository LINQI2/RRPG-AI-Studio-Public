import fs from "node:fs";
import path from "node:path";
import type {Store} from "../db.js";
import type {Config} from "../config.js";
import {UnityConnection} from "./connection.js";
import {maintenance} from "../runtime-status.js";
import type {Row} from "../../shared/contracts.js";
// Only rechecks a definite, never-dispatched editor-busy rejection. It neither
// runs tests nor closes Play, changes locks, permissions, files or task states.
export class UnityRecoveryMonitor {
  private checking=false;
  constructor(private store:Store,private cfg:Config,private submit:(input:Row,sender:string,key:string)=>Row,private ready:()=>boolean,private connection= new UnityConnection(cfg)){}
  async tick(){
    if(this.checking||!this.ready()||maintenance(this.cfg))return;
    this.checking=true;
    try{
      const jobs=this.store.all("executions");
      if(jobs.some(j=>["preparing","dispatching","running","verifying","preflight","cancelling","unknown"].includes(j.status)))return;
      const dir=path.join(this.cfg.runtime,"unity-tests");if(!fs.existsSync(dir))return;
      const records=fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(path.join(dir,n),"utf8")));
      for(const job of [...jobs].reverse()){
        if(job.status!=="failed"||!job.taskId||!job.owner)continue;
        const task=this.store.get("tasks",job.taskId),owner=this.store.get("agents",job.owner);
        if(job.status!=="failed"||!job.sdkExitConfirmed||task?.status!=="blocked"||owner?.status!=="idle"||owner.activeTurnId)continue;
        if(jobs.some(j=>j.taskId===job.taskId&&Date.parse(j.createdAt)>Date.parse(job.createdAt)))continue;
        if(this.store.all("messages").some(m=>m.recipient===job.owner&&["recorded","dispatching","accepted","in_progress","queued_native","unknown"].includes(m.delivery)))continue;
        const record=records.find(r=>r.executionId===job.id&&r.state==="rejected"&&r.reasonCode==="editor_busy"&&!r.requestedAt);
        if(!record)continue;
        const key=`unity-idle-owner-review:${record.id}`;if(this.store.get("settings",key))continue;
        const taskReviewKey=`unity-idle-task-review:${job.taskId}`;
        if(this.store.get("settings",taskReviewKey))continue; // owner takes over; no paid recheck loop
        let native:Row;
        try{await this.connection.recover();native=await this.connection.reviewIdle();}
        catch(e){this.store.put("settings",{id:`unity-busy-check:${record.id}`,checkedAt:new Date().toISOString(),reason:String(e)});return;}
        if(path.resolve(native.identity.project).toLowerCase()!==path.resolve(record.project).toLowerCase())throw Error("恢复核对工程不一致");
        // Re-read because the read-only native request may have yielded to user actions.
        const latestOwner=this.store.get("agents",job.owner);
        if(!this.ready()||maintenance(this.cfg)||latestOwner?.status!=="idle"||latestOwner.activeTurnId||latestOwner.threadId!==owner.threadId||this.store.all("executions").some(j=>["preparing","dispatching","running","verifying","preflight","cancelling","unknown"].includes(j.status)))return;
        if(this.store.get("tasks",job.taskId)?.status!=="blocked"||this.store.all("messages").some(m=>m.recipient===job.owner&&["recorded","dispatching","accepted","in_progress","queued_native","unknown"].includes(m.delivery)))return;
        const msg=this.submit({recipient:job.owner,taskId:job.taskId,kind:"request",content:`临时占用恢复核对（只读环境事实，不是新授权）：原测试${record.id}因编辑器占用被明确拒绝，未发送测试。当前配置工程、原生TestRunner及pending均已核对空闲。请沿原任务重新核对保护/场景和实际授权，安全续接缺少的验证。系统没有运行测试、改任务状态、停止播放或解除锁；旧失败保留。未知副作用、存档风险、新权限仍须按原边界处理，不循环重试。`},"unity-recovery-monitor",key);
        this.store.atomic(()=>{this.store.put("settings",{id:key,messageId:msg.id,recordId:record.id,observedAt:native.observedAt});this.store.put("settings",{id:taskReviewKey,messageId:msg.id,recordId:record.id});});break;
      }
    }finally{this.checking=false;}
  }
}
