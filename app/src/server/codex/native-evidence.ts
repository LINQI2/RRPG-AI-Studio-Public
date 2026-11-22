import fs from "node:fs";
import path from "node:path";
import { safePath } from "../config.js";
// Some code-mode calls are not projected to App Server commandExecution items.
// Read only public tool calls/results from the bound native rollout, never
// reasoning, session instructions, credentials, or arbitrary browser paths.
export function nativeToolEvidence(home: string, rolloutPath: string) {
  const plain = rolloutPath.startsWith("\\\\?\\")
    ? rolloutPath.slice(4)
    : rolloutPath;
  const file = safePath(path.join(home, "sessions"), plain);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
    throw Error("Native evidence file unavailable or exceeds read limit");
  let turnId: string | null = null;
  const calls = new Map<string, any>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const p = row.payload;
    if (row.type === "event_msg" && p?.type === "task_started")
      turnId = p.turn_id || p.turn_attribution?.turn_id || null;
    if (row.type !== "response_item" || !p) continue;
    if (["function_call", "custom_tool_call"].includes(p.type))
      calls.set(p.call_id, {
        id: p.call_id,
        turnId,
        source: "native-rollout",
        rawType: p.type,
        name: p.name,
        input: p.input ?? p.arguments,
        startedAt: row.timestamp,
      });
    if (["function_call_output", "custom_tool_call_output"].includes(p.type)) {
      const call = calls.get(p.call_id);
      if (call) {
        call.output = p.output;
        call.completedAt = row.timestamp;
      }
    }
  }
  return [...calls.values()];
}
