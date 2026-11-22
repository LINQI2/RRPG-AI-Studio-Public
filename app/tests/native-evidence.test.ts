import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appRoot } from "../src/server/config.js";
import { nativeToolEvidence } from "../src/server/codex/native-evidence.js";
it("projects public native tool calls/results without exposing reasoning or instructions", () => {
  const home = path.join(appRoot, "runtime/tests/native-" + Date.now());
  const dir = path.join(home, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "rollout.jsonl");
  const rows = [
    { type: "session_meta", payload: { instructions: "PRIVATE_INSTRUCTION" } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "t1" } },
    {
      type: "response_item",
      payload: { type: "reasoning", content: "PRIVATE_REASONING" },
    },
    {
      type: "response_item",
      timestamp: "start",
      payload: {
        type: "custom_tool_call",
        call_id: "c1",
        name: "exec",
        input: "read fixture",
      },
    },
    {
      type: "response_item",
      timestamp: "end",
      payload: {
        type: "custom_tool_call_output",
        call_id: "c1",
        output: "actual result",
      },
    },
    { type: "event_msg", payload: { type: "task_started", turn_id: "t2" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "c2",
        name: "studio_task",
        arguments: "{}",
      },
    },
  ];
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n"));
  const result = nativeToolEvidence(home, file);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    turnId: "t1",
    output: "actual result",
    source: "native-rollout",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(result[1].turnId).toBe("t2");
  expect(() =>
    nativeToolEvidence(home, path.join(appRoot, "package.json")),
  ).toThrow("outside");
});
