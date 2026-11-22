import type { Row } from "../../shared/contracts.js";
export class McpToolError extends Error {
  constructor(message: string, public response: Row) { super(message); }
}
export function unityToolValue(r: Row): any {
  // 0.89 wraps result; 1.3 returns structured test data directly and RQL
  // scalar text for script-execute. Never turn an unrecognized response into success.
  let value: any = r.structuredContent;
  if (value === undefined) {
    const blocks = (r.content || []).filter((b: Row) => b.type === "text");
    if (blocks.length !== 1) throw Error("MCP返回不明确的工具结果，须核对原始记录");
    value = blocks[0].text;
    if (typeof value === "string" && value.startsWith("System.String:"))
      value = value.slice("System.String:".length).trim();
  }
  for (let i = 0; i < 4; i++) {
    if (value && typeof value === "object" && "result" in value) { value = value.result; continue; }
    if (typeof value !== "string") break;
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}
export class UnityMcp {
  private session?: string;
  private protocol = "2025-03-26";
  private id = 0;
  constructor(
    private token: string,
    private endpoint: string,
  ) {
    const url = new URL(endpoint);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw Error("MCP仅允许回环地址");
  }
  async call(method: string, params: Row = {}, notify = false): Promise<any> {
    // Unity's tests-run validates the full test tree before returning Processing.
    // Allow the 600-second discovery budget plus response overhead; keep
    // ordinary MCP calls short so a disconnected editor fails promptly.
    const toolName = method === "tools/call" ? String(params.name ?? "") : "";
    const timeoutMs = toolName === "tests-run" ? 660_000 : 15_000;
    const response = await fetch(this.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer " + this.token,
        ...(this.session
          ? {
              "Mcp-Session-Id": this.session,
              "MCP-Protocol-Version": this.protocol,
            }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notify ? {} : { id: ++this.id }),
        method,
        params,
      }),
    });
    if (!response.ok) {
      if (response.status === 404 || response.status === 400)
        this.session = undefined;
      throw Error(`MCP HTTP ${response.status}；没有重发工具操作`);
    }
    this.session = response.headers.get("mcp-session-id") || this.session;
    const raw = await response.text();
    if (!raw) return;
    const rows = response.headers
      .get("content-type")
      ?.includes("text/event-stream")
      ? raw
          .split(/\r?\n/)
          .filter((x) => x.startsWith("data:"))
          .map((x) => JSON.parse(x.slice(5)))
      : [JSON.parse(raw)];
    const r = rows.find((x) => x.id !== undefined) || rows.at(-1);
    if (r?.error) throw Error(`MCP ${r.error.code}`);
    return r?.result;
  }
  async connect() {
    this.session = undefined;
    const r = await this.call("initialize", {
      protocolVersion: this.protocol,
      capabilities: {},
      clientInfo: { name: "rrpg-studio-lifecycle", version: "1.0" },
    });
    this.protocol = r.protocolVersion;
    await this.call("notifications/initialized", {}, true);
    return r;
  }
  async tool(name: string, args: Row = {}, received?: (response: Row) => void) {
    const r = await this.call("tools/call", { name, arguments: args });
    received?.(r);
    if (r.isError) {
      const details = (r.content ?? [])
        .filter((b: Row) => b.type === "text")
        .map((b: Row) => String(b.text ?? ""))
        .join("\n")
        .replaceAll(this.token, "[REDACTED]")
        .slice(0, 1600);
      throw new McpToolError(
        `Unity MCP 工具失败（${name}）：${details || "请核对本次宿主日志"}`,
        r,
      );
    }
    return unityToolValue(r);
  }
}
