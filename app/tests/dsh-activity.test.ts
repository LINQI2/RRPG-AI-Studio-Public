import { expect, test } from "vitest";
import { Store } from "../src/server/db.js";

test("activity reflects native work time rather than replay receipt, status edits or transport acknowledgements", () => {
  const store = new Store(":memory:");
  try {
    store.create("executions", { id: "working", status: "running" });
    store.create("executions", { id: "empty", status: "preparing" });
    store.create("execution_events", { id: "1", executionId: "working", event: { type: "tool/result", time: 1000 } });
    expect(store.executionActivity().get("working")).toBe(1000);
    store.create("execution_events", { id: "2", executionId: "working", event: { type: "step/start", time: 3000 } });
    store.create("execution_events", { id: "3", executionId: "working", event: { type: "session-log-deepseek/delivery-accepted", time: 9000 } });
    store.create("execution_events", { id: "replayed", executionId: "working", event: { type: "tool/result", time: 2000 } });
    store.update("executions", "working", { summary: "Only metadata changed" });
    expect(store.executionActivity().get("working")).toBe(3000);
    expect(store.executionActivity().has("empty")).toBe(false);
  } finally { store.close(); }
});
