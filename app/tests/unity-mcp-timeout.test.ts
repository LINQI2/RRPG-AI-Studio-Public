import { afterEach, expect, it, vi } from "vitest";
import { UnityMcp, unityToolValue } from "../src/server/unity/mcp.js";

it("reads both legacy envelopes and current structured/RQL results without inventing success", () => {
  const identity = { project: "D:\\fixture\\Unity", version: "fixture-version", compiling: false };
  expect(unityToolValue({ content: [{ type: "text", text: `System.String: ${JSON.stringify(JSON.stringify(identity))}` }] })).toEqual(identity);
  const result = { Summary: { Status: "Passed", TotalTests: 1 }, Results: [{ Name: "fixture" }] };
  expect(unityToolValue({ structuredContent: result })).toEqual(result);
  expect(unityToolValue({ content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify(result) }) }] })).toEqual(result);
  expect(unityToolValue({ content: [{ type: "text", text: "unknown native format" }] })).toBe("unknown native format");
  expect(() => unityToolValue({ content: [] })).toThrow("不明确");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockMcpResponse() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

it("allows 600-second Unity test-list discovery plus response overhead", async () => {
  mockMcpResponse();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const client = new UnityMcp("test-token", "http://127.0.0.1:21999/mcp");

  await client.call("tools/call", { name: "tests-run", arguments: {} });

  expect(timeout).toHaveBeenCalledWith(660_000);
});

it("keeps ordinary Unity MCP calls on the short timeout", async () => {
  mockMcpResponse();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const client = new UnityMcp("test-token", "http://127.0.0.1:21999/mcp");

  await client.call("tools/call", { name: "studio-lab-identity", arguments: {} });

  expect(timeout).toHaveBeenCalledWith(15_000);
});

it.each(["initialize", "tools/list", "notifications/initialized"])(
  "keeps %s short even when params contain a tests-run name",
  async (method) => {
    mockMcpResponse();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await new UnityMcp("test-token", "http://127.0.0.1:21999/mcp").call(method, { name: "tests-run" });
    expect(timeout).toHaveBeenCalledWith(15_000);
  },
);

it("preserves a plugin discovery error without leaking the bearer token or retrying", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text",
      text: "Unity test-list retrieval timed out after 600 seconds; token=test-token" }] },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(new UnityMcp("test-token", "http://127.0.0.1:21999/mcp").tool("tests-run")).rejects.toThrow(
    "Unity test-list retrieval timed out after 600 seconds; token=[REDACTED]",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
