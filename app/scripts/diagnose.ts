import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  configuration,
  appRoot,
  studioRoot,
  codexEnvironment,
} from "../src/server/config.js";
import { Transport } from "../src/server/codex/transport.js";
const cfg = configuration();
for (const p of [cfg.home, cfg.project]) fs.mkdirSync(p, { recursive: true });
const evidence = path.join(cfg.runtime, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const report: any = {
  started: new Date().toISOString(),
  kind: "real-local-app-server-read-only",
  modelCalls: 0,
  steps: [],
};
for (const [label, home] of [
  ["studio", cfg.home],
]) {
  const rpc = new Transport(
    cfg.exe,
    ["app-server", "--stdio"],
    cfg.project,
    codexEnvironment(home),
    15000,
  );
  try {
    const init = await rpc.start();
    report.steps.push({
      label,
      method: "initialize",
      status: "PASS",
      result: init,
    });
    const account = await rpc.call("account/read", { refreshToken: false });
    report.steps.push({
      label,
      method: "account/read",
      status: "PASS",
      authenticated: Boolean(account.account),
    });
    if (label === "historical-default")
      for (const threadId of (process.env.STUDIO_DIAGNOSTIC_THREAD_IDS ?? "").split(",").filter(Boolean))
        for (const [method, params] of [
          ["thread/read", { threadId }],
          ["thread/turns/list", { threadId, limit: 20, itemsView: "full" }],
          ["thread/goal/get", { threadId }],
        ] as const) {
          try {
            const result = await rpc.call(method, params);
            report.steps.push({
              label,
              method,
              threadId,
              status: "PASS",
              result,
            });
          } catch (e) {
            report.steps.push({
              label,
              method,
              threadId,
              status: "FAIL",
              error: String(e),
            });
          }
        }
  } catch (e) {
    report.steps.push({ label, status: "FAIL", error: String(e) });
  } finally {
    await rpc.stop();
  }
}
report.ended = new Date().toISOString();
const file = path.join(evidence, `real-diagnostics-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    { file, steps: report.steps.map(({ result, ...rest }: any) => rest) },
    null,
    2,
  ),
);
