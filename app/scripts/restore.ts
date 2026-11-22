import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { configuration, appRoot, safePath } from "../src/server/config.js";
// Non-destructive restore: always creates a new runtime directory, never replaces a live DB.
const cfg = configuration();
const source = safePath(appRoot, path.resolve(process.argv[2] || ""));
if (!fs.statSync(source).isFile()) throw Error("Backup file required");
const check = new DatabaseSync(source, { readOnly: true });
try {
  const result = check.prepare("PRAGMA integrity_check").get() as any;
  if (result.integrity_check !== "ok")
    throw Error("Backup integrity check failed");
  const v = check.prepare("SELECT version FROM schema_version").get() as any;
  if (v.version !== 1) throw Error("Unsupported backup schema");
} finally {
  check.close();
}
const target = safePath(
  appRoot,
  path.join(cfg.runtime, `restored-${Date.now()}`),
);
fs.mkdirSync(target);
fs.copyFileSync(
  source,
  path.join(target, "studio.sqlite"),
  fs.constants.COPYFILE_EXCL,
);
// Native CODEX_HOME owns native history. Keep its path in config by selecting the original home explicitly.
fs.writeFileSync(
  path.join(target, "RESTORE-NOTES.txt"),
  `Database recovered from ${source}. Original Codex history is in ${cfg.home}. Do not start under a different home without restoring that history. All in-flight records must be reconciled.\n`,
);
console.log(
  JSON.stringify(
    {
      target,
      originalHome: cfg.home,
      next: "Set STUDIO_RUNTIME to target and STUDIO_CODEX_HOME to originalHome after stopping Studio.",
    },
    null,
    2,
  ),
);
