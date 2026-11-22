import fs from "node:fs";
import path from "node:path";
import { inside, type Config } from "./config.js";

// Operator-owned configuration. No project is selected by default; web/model
// requests cannot alter filesystem scope or the Unity endpoint.
export function projectSettings(runtime: string) {
  const file = path.join(runtime, "project-config.json");
  const value = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  const root = value.projectRoot || null;
  if (root && (!path.isAbsolute(root) || !fs.statSync(root).isDirectory()))
    throw Error("项目配置需要存在的绝对目录");
  if (
    root &&
    root.split(/[\\/]/).some((p: string) => p.toLowerCase() === "archive")
  )
    throw Error("归档不能用作活动工程");
  const unity = value.unity || {};
  return { root, unity };
}
export function unitySettings(cfg: Config) {
  const { root, unity } = projectSettings(cfg.runtime);
  if (!root || unity.enabled !== true)
    throw Error("尚未配置工程；请手动打开编辑器并配置 MCP");
  const unityRoot = unity.projectPath ? path.resolve(root, unity.projectPath) : path.resolve(root);
  if (!inside(path.resolve(root), unityRoot) || !fs.statSync(unityRoot).isDirectory() ||
    !inside(fs.realpathSync(root), fs.realpathSync(unityRoot)))
    throw Error("Unity子工程必须位于已配置仓库内，不能连接其他工程");
  const endpoint = new URL(unity.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
  )
    throw Error("Unity MCP 仅允许显式配置的回环 HTTP 地址");
  const tokenFile = path.resolve(cfg.runtime, unity.tokenFile || "");
  if (!inside(path.join(cfg.runtime, "credentials"), tokenFile))
    throw Error("MCP 凭据必须在运行目录的 credentials 内");
  const token = JSON.parse(fs.readFileSync(tokenFile, "utf8")).token;
  if (typeof token !== "string" || token.length < 16)
    throw Error("MCP 认证配置无效");
  const versionFile = path.join(unityRoot, "ProjectSettings/ProjectVersion.txt");
  const version =
    unity.expectedVersion ||
    /m_EditorVersion:\s*(\S+)/.exec(fs.readFileSync(versionFile, "utf8"))?.[1];
  if (!version) throw Error("无法确认工程编辑器版本");
  return {
    root: unityRoot,
    repositoryRoot: path.resolve(root),
    endpoint: endpoint.href,
    token,
    version,
    allowExecution: unity.allowExecution === true,
  };
}
