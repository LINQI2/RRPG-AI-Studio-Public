import { it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Store } from "../src/server/db.js";
import { appRoot } from "../src/server/config.js";
import { DshSupervisor } from "../src/server/dsh/supervisor.js";
const databases: Store[] = [];
afterEach(() => { for (const s of databases.splice(0)) s.close(); });
function setup(interval: number | undefined = 1000) {
  const dir = fs.mkdtempSync(path.join(appRoot, "runtime/tests/supervisor-"));
  const s = new Store(path.join(dir, "db.sqlite")); databases.push(s);
  s.put("agents", { id: "developer", threadId: "existing", status: "idle" });
  s.put("tasks", { id: "t", owner: "developer", title: "工作包", status: "running" });
  s.put("executions", { id: "e", owner: "developer", taskId: "t", status: "running", createdAt: new Date(0).toISOString() });
  let time = 0; const calls: any[] = [], keys = new Set<string>();
  const make = () => new DshSupervisor(s, (input, sender, key) => {
    if (!keys.has(key)) { calls.push({ input, sender, key }); keys.add(key); }
    return { id: key };
  }, () => true, () => time, interval === 0 ? undefined : interval);
  return { s, calls, make, at: (n: number) => { time = n; } };
}
it("checks only after cooldown, emits one unchanged/stall review and survives restart", () => {
  const x = setup(); const monitor = x.make(); monitor.tick(); expect(x.calls).toHaveLength(0);
  x.at(1000); monitor.tick(); expect(x.calls).toHaveLength(1);
  expect(x.calls[0].sender).toBe("dsh-supervisor");
  expect(x.calls[0].input.content).toContain("不是制作人新授权");
  x.at(1500); x.make().tick(); expect(x.calls).toHaveLength(1);
  x.at(2000); x.make().tick(); expect(x.calls).toHaveLength(2);
  x.at(9999); x.make().tick(); expect(x.calls).toHaveLength(2);
  x.s.put("execution_events", { id: "new", executionId: "e", event: { seq: 3 } });
  x.make().tick(); expect(x.calls).toHaveLength(3);
});
it("never queues behind a busy owner, uncertain message or completed task", () => {
  const x = setup(); x.at(2000);
  x.s.put("agents", { id: "developer", threadId: "existing", status: "active" });
  x.make().tick(); expect(x.calls).toHaveLength(0);
  x.s.put("agents", { id: "developer", threadId: "existing", status: "idle" });
  x.s.put("messages", { id: "m", recipient: "developer", delivery: "unknown" });
  x.make().tick(); expect(x.calls).toHaveLength(0);
  x.s.update("messages", "m", { delivery: "completed" });
  x.s.update("tasks", "t", { status: "completed" });
  x.make().tick(); expect(x.calls).toHaveLength(0);
});
it("final result notification is not duplicated, and no review mutates or restarts execution", () => {
  const x = setup(); x.at(2000); x.s.update("executions", "e", { status: "failed", modelOutcome: "max-tokens" });
  x.make().tick(); expect(x.calls).toHaveLength(0);
  x.s.update("executions", "e", { status: "unknown" });
  const before = x.s.get("executions", "e"); x.make().tick();
  expect(x.calls).toHaveLength(1); expect(x.s.get("executions", "e")).toEqual(before);
});

it("defaults to fifteen minutes, includes bounded live steps and upgrades old cooldowns", () => {
  const x=setup(0);
  x.s.put("settings",{id:"dsh-supervision:e",checkedAt:new Date(0).toISOString(),nextAt:300000});
  x.s.put("execution_events",{id:"ev",executionId:"e",event:{seq:1,type:"tool/call",time:"2026-10-26T00:00:00Z",data:{step:7,name:"tests-run",arguments:"PRIVATE_RAW"}}});
  x.at(300000);x.make().tick();expect(x.calls).toHaveLength(0);
  x.at(899999);x.make().tick();expect(x.calls).toHaveLength(0);
  x.at(900000);x.make().tick();expect(x.calls).toHaveLength(1);
  expect(x.calls[0].input.content).toContain("tests-run");
  expect(x.calls[0].input.content).toContain("允许继续原Session");
  expect(x.calls[0].input.content).not.toContain("PRIVATE_RAW");
});
