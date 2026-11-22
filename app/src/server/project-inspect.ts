import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Fixed host-side read-only operation, not an agent-supplied command or shell.
export function inspectProject(root: string) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw Error("项目根不能是重解析路径");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const git = (args: string[], allowMissingHead = false) => {
    const result = spawnSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
      cwd: root, env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      windowsHide: true, shell: false, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (allowMissingHead && result.status === 128) return "";
    if (result.status !== 0) throw Error("固定只读Git检查失败，未执行写入或远程操作");
    return result.stdout;
  };
  if (path.resolve(git(["rev-parse", "--show-toplevel"]).trim()).toLowerCase() !== root.toLowerCase())
    throw Error("配置目录不是实际仓库根；不能核对其他仓库");
  const before = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const chunks = before.split("\0"), rows: { status: string; path: string; originalPath?: string }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) continue;
    const status = chunks[i].slice(0, 2), relative = chunks[i].slice(3);
    rows.push({ status, path: relative, ...(/[RC]/.test(status) ? { originalPath: chunks[++i] } : {}) });
  }
  if (rows.length > 2000) throw Error("变更超过2000项，须维护者分批核对，未省略成完整基线");
  let bytes = 0;
  const files = rows.map(row => {
    const segments = row.path.split("/");
    if (segments[0]?.toLowerCase() === "runtime" || segments.some(s => !s || s === "." || s === ".." || /^(\.git|\.codex|\.dsh|credentials|archive)$/i.test(s)) ||
      /^(\.env.*|auth\.json|.*credentials.*)$/i.test(segments.at(-1)!))
      return { ...row, excluded: "敏感或受保护路径，不读取内容" };
    const target = path.resolve(root, row.path);
    if (!target.toLowerCase().startsWith((root + path.sep).toLowerCase())) throw Error("路径越界");
    for (let part = target; part !== root; part = path.dirname(part))
      if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw Error("变更路径含重解析点");
    if (!fs.existsSync(target)) return { ...row, missing: true };
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024 || (bytes += stat.size) > 512 * 1024 * 1024)
      throw Error("基线文件超过固定读取预算，不能声明已完整核对");
    const content = fs.readFileSync(target);
    return { ...row, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
  });
  if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]) !== before)
    throw Error("核验期间工作区状态变化，须重新读取，未写入项目");
  return { source: "studio-fixed-read-only-git-sha256", root, at: new Date().toISOString(),
    branch: git(["branch", "--show-current"]).trim(), head: git(["rev-parse", "--verify", "HEAD"], true).trim() || null,
    complete: !files.some(f => "excluded" in f), consistency: "status-stable; not an atomic filesystem snapshot", files };
}
