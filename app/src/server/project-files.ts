import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 64 * 1024;
const EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".mjs",
  ".js",
  ".ts",
  ".cs",
  ".uxml",
  ".uss",
  ".shader",
  ".hlsl",
  ".asmdef",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export function readProjectFile(authorizedRoot: string, relativePath: string) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length > 240 ||
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath)
  )
    throw Error("Invalid project-relative file path");
  const segments = relativePath.split("/");
  if (
    segments[0]?.toLowerCase() === "runtime" || segments.some((s) =>
      /^(archive|library|temp|node_modules|\.git|\.codex|\.dsh)$/i.test(
        s,
      ),
    ) ||
    /^(auth\.json|\.env|.*credentials.*)$/i.test(segments.at(-1) || "")
  )
    throw Error("归档、运行记录和认证文件不属于项目文件入口");
  if (
    segments.some(
      (s) =>
        !s ||
        s === "." ||
        s === ".." ||
        s.endsWith(".") ||
        s.endsWith(" ") ||
        /[<>:"|?*\u0000-\u001f\u007f]/.test(s) ||
        /\p{Cf}/u.test(s) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
    )
  )
    throw Error("Unsafe project file path");
  const root = path.resolve(authorizedRoot);
  const target = path.resolve(root, ...segments);
  if (!target.toLowerCase().startsWith((root + path.sep).toLowerCase()))
    throw Error("Outside project root");
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw Error("Unsafe project root");
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw Error("Link/reparse point not permitted");
    if (current !== target && !stat.isDirectory())
      throw Error("Non-directory path component");
  }
  if (!EXTENSIONS.has(path.extname(target).toLowerCase()))
    throw Error("Unsupported file type");
  const realRoot = fs.realpathSync.native(root);
  const realTarget = fs.realpathSync.native(target);
  if (!realTarget.toLowerCase().startsWith((realRoot + path.sep).toLowerCase()))
    throw Error("File resolves outside project");
  const fd = fs.openSync(
    target,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw Error("Not a supported text file or file too large");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > MAX_BYTES) throw Error("File too large");
    const bytes = buffer.subarray(0, total);
    const content = decoder.decode(bytes);
    return {
      path: relativePath,
      content,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    fs.closeSync(fd);
  }
}
