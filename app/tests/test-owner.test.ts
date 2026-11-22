import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appRoot } from "../src/server/config.js";
import { installTestOwner } from "../src/server/dsh/test-owner.js";
it("official guard adapter refuses direct test calls and leaves normal MCP calls unchanged", async () => {
  const home = fs.mkdtempSync(path.join(appRoot, "runtime/tests/test-owner-"));
  const { pluginUrl, receipt } = installTestOwner(home, home);
  const plugin = await import(/* @vite-ignore */ pluginUrl);
  let guard: (call: any) => string | undefined = () => undefined;
  plugin.apply({ tools: { guard: (callback: typeof guard) => { guard = callback; } } });
  expect(guard({ name: "mcp__studio-unity__tests-run" })).toContain("持久测试阶段");
  expect(guard({ name: "mcp__studio-unity__script-execute" })).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(receipt, "utf8")).version).toBe(1);
  expect(() => plugin.apply({ tools: {} })).toThrow("unavailable");
});
it("protected project guard refuses implicit global saves while keeping scoped editor APIs available", async () => {
  const home = fs.mkdtempSync(path.join(appRoot, "runtime/tests/test-owner-"));
  const { pluginUrl, receipt } = installTestOwner(home, home, true);
  const plugin = await import(/* @vite-ignore */ pluginUrl);
  let guard: (call: any) => string | undefined = () => undefined;
  plugin.apply({ tools: { guard: (callback: typeof guard) => { guard = callback; } } });
  expect(guard({ name: "mcp__studio-unity__rql-mutate", arguments: { query: "editor | call RefreshAssets()" } })).toContain("保存全部");
  expect(guard({ name: "mcp__studio-unity__script-execute" })).toBeUndefined();
  expect(guard({ name: "mcp__studio-unity__rql-query" })).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(receipt, "utf8")).globalMutationSaveBlocked).toBe(true);
});
