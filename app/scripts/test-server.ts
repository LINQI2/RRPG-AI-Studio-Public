// Explicit offline browser-test server. Not used by npm start.
import fs from "node:fs";
import path from "node:path";
import { configuration, appRoot } from "../src/server/config.js";
import { Store } from "../src/server/db.js";
import { Transport } from "../src/server/codex/transport.js";
import { Studio } from "../src/server/studio.js";
import { webServer } from "../src/server/http.js";
const base = path.join(appRoot, "runtime/browser-tests");
fs.mkdirSync(base, { recursive: true });
const runtime = fs.mkdtempSync(path.join(base, "run-"));
const cfg = {
  ...configuration(),
  runtime,
  project: path.join(runtime, "project"),
  inbox: path.join(runtime, "inbox"),
  home: path.join(runtime, "home"),
  port: 3199,
  rulesRoot:path.join(runtime,'rules'),
};
for (const p of [cfg.project, cfg.inbox, cfg.home])
  fs.mkdirSync(p, { recursive: true });
fs.cpSync(configuration().rulesRoot,cfg.rulesRoot,{recursive:true});
const db = new Store(path.join(runtime, "test.sqlite"));
const rpc = new Transport(
  process.execPath,
  [path.join(appRoot, "tests/fake-server.mjs")],
  runtime,
  { ...process.env, FAKE_STATE: path.join(runtime, "fake.json") },
);
const studio = new Studio(db, rpc, cfg);
db.create("settings",{id:"environment",kind:"simulated",label:"协议模拟"});
fs.writeFileSync(path.join(cfg.project,"README.md"),"# 项目文件\n隔离测试文本，不执行。\n");
await studio.connect();
await studio.initialize();
if(process.env.STUDIO_UI_REVIEW === "1") {
  db.create("decisions",{id:"ui-decision",owner:"planner",status:"open",question:"模拟素材：方案 A 与 B 如何选择？",facts:"仅验收输入面板，不是正式设计决定。",options:["A：展示更多成果","B：展示更多过程"]});
  db.create("requests",{id:"ui-question",owner:"planner",rpcId:"ui-only",status:"open",questions:[{id:"scope",question:"模拟问题：本次文案范围是什么？"}]});
  const t=studio.createTask({title:"模拟：手工补录入口",objective:"只验证界面，不代表模型执行",owner:"developer",purpose:"lab"});
  fs.writeFileSync(path.join(cfg.inbox,"ui-handoff.json"),JSON.stringify({id:"ui-handoff",title:"模拟设计交接",content:"只用于验证审查输入，不是 GameSpec",producerConfirmed:true,provenance:"隔离 UI fixture"}));
  const {Bridge}=await import('../src/server/bridge.js');const b=new Bridge(studio);b.scan();b.notify('ui-handoff');
  db.update('agents','planner',{status:'active',activeTurnId:'ui-steer-only'});
}
const app = await webServer(studio);
await app.listen({ host: "127.0.0.1", port: 3199 });
const stop = async () => {
  await rpc.stop();
  await app.close();
  db.close();
  process.exit(0);
};
studio.onShutdown = stop;
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
