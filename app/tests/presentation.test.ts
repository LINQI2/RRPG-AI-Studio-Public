import { it, expect } from "vitest";
import {
  itemSummary,
  inMessageView,
  errorSummary,
} from "../src/web/presentation.js";
it("keeps producer replies out of peer-only filter while preserving true cross-lead messages", () => {
  expect(
    inMessageView({ sender: "planner", recipient: "producer" }, "peers"),
  ).toBe(false);
  expect(
    inMessageView({ sender: "developer", recipient: "planner" }, "peers"),
  ).toBe(true);
  expect(
    inMessageView({ sender: "planner", recipient: "developer" }, "developer"),
  ).toBe(true);
});
it("does not turn a raw completion timestamp or unknown native type into success", () => {
  expect(
    itemSummary({
      name: "exec",
      rawType: "custom_tool_call",
      completedAt: "now",
      output: [{ text: "Script error: blocked by policy" }],
    }).result,
  ).toContain("错误");
  expect(itemSummary({ name: "exec", completedAt: "now" }).result).toContain(
    "待核对",
  );
  expect(itemSummary({ type: "futureNativeItem" }).action).toContain(
    "futureNativeItem",
  );
  expect(
    itemSummary({ tool: "studio_send_message", success: true }).result,
  ).toBe("工具返回成功");
});
it("provides concise Chinese errors without changing raw records", () => {
  expect(errorSummary("RPC timeout; outcome unknown")).toContain("核对");
  expect(errorSummary("native MXC unavailable")).toContain("限制");
  expect(errorSummary("EACCES opening a file")).toContain("拒绝了访问");
});
