import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
export const maintenance = (cfg: Config) => fs.existsSync(path.join(cfg.runtime, "maintenance.json"));
export function buildFingerprint(root = path.dirname(fileURLToPath(import.meta.url))) {
  const files: string[] = [];
  function walk(dir: string) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) walk(file);
    else if (entry.isFile() && /\.(js|ts)$/.test(entry.name)) files.push(file);
  } }
  walk(root);
  const hash = createHash("sha256");
  for (const file of files.sort()) { hash.update(path.relative(root, file)); hash.update(fs.readFileSync(file)); }
  return hash.digest("hex");
}
