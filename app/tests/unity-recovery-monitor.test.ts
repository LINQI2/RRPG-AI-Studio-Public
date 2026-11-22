import {test,expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {Store} from "../src/server/db.js";
import {appRoot,configuration} from "../src/server/config.js";
import {UnityRecoveryMonitor} from "../src/server/unity/recovery-monitor.js";
function setup(){const runtime=fs.mkdtempSync(path.join(appRoot,"runtime/recovery-monitor-test-"));const store=new Store(":memory:");const cfg={...configuration(),runtime};store.put("agents",{id:"developer",threadId:"original",status:"idle"});store.put("tasks",{id:"t",status:"blocked"});store.put("executions",{id:"e",taskId:"t",owner:"developer",status:"failed",sdkExitConfirmed:true,createdAt:"2026-10-24T00:00:00Z"});fs.mkdirSync(path.join(runtime,"unity-tests"));const file=path.join(runtime,"unity-tests/11111111-1111-1111-1111-111111111111.json");fs.writeFileSync(file,JSON.stringify({id:"test",executionId:"e",state:"rejected",reasonCode:"editor_busy",project:runtime}));let busy=false,reads=0;const calls:any[]=[];const connection={recover:async()=>{},reviewIdle:async()=>{reads++;if(busy)throw Error("still playing");return {identity:{project:runtime},observedAt:"native"};}};return {store,cfg,file,calls,setBusy:(v:boolean)=>busy=v,reads:()=>reads,make:()=>new UnityRecoveryMonitor(store,cfg,(input,sender,key)=>{calls.push({input,sender,key});return {id:key};},()=>true,connection as any)};}
test("only confirmed busy rejection is rechecked; one deduped owner review survives restart without replaying tests",async()=>{
 const x=setup();try{x.setBusy(true);await x.make().tick();expect(x.calls).toHaveLength(0);x.setBusy(false);await x.make().tick();await x.make().tick();expect(x.calls).toHaveLength(1);expect(x.calls[0].input.content).toContain("没有运行测试");expect(x.store.get("tasks","t")?.status).toBe("blocked");expect(x.store.get("executions","e")?.status).toBe("failed");}finally{x.store.close();}
});
test("unknown dispatch, active jobs, maintenance or a newer execution forbid automatic recovery",async()=>{
 const x=setup();try{x.store.put("executions",{id:"other",status:"unknown"});await x.make().tick();expect(x.reads()).toBe(0);x.store.put("executions",{id:"other",taskId:"t",status:"finished_unverified",createdAt:"2026-10-25T00:00:00Z"});await x.make().tick();expect(x.reads()).toBe(0);x.store.put("executions",{id:"other",status:"finished_unverified"});fs.writeFileSync(path.join(x.cfg.runtime,"maintenance.json"),"{}");await x.make().tick();expect(x.reads()).toBe(0);expect(x.calls).toHaveLength(0);}finally{x.store.close();}
});
test("a request already sent or unknown is not treated as a safe preflight rejection",async()=>{
 const x=setup();try{const r=JSON.parse(fs.readFileSync(x.file,"utf8"));fs.writeFileSync(x.file,JSON.stringify({...r,requestedAt:"2026-10-24T00:00:00Z"}));await x.make().tick();expect(x.reads()).toBe(0);expect(x.calls).toHaveLength(0);}finally{x.store.close();}
});
