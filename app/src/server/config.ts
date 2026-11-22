import path from "node:path";
import fs from "node:fs";
import { projectSettings } from "./project-config.js";
import os from "node:os";
import { fileURLToPath } from "node:url";
export const appRoot = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
export const studioRoot = path.dirname(appRoot);
export function inside(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
export function safePath(root: string, target: string) {
  const resolved = path.resolve(target);
  if (!inside(root, resolved)) throw Error("Path outside authorized workspace");
  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) throw Error("Invalid path");
    probe = parent;
  }
  if (!inside(fs.realpathSync(root), fs.realpathSync(probe)))
    throw Error("Reparse point outside authorized workspace");
  return resolved;
}
export function configuration() {
  const runtime = safePath(
    appRoot,
    process.env.STUDIO_RUNTIME || path.join(appRoot, "runtime"),
  );
  const home = safePath(
    appRoot,
    process.env.STUDIO_CODEX_HOME || path.join(runtime, "codex-home"),
  );
  const exe =
    process.env.STUDIO_CODEX_EXE ||
    path.join(
      os.homedir(),
      "AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    );
  return {
    runtime,
    rulesRoot: path.join(studioRoot, "rules"),
    home,
    exe,
    port: Number(process.env.STUDIO_PORT || 3178),
    project: process.env.STUDIO_PROJECT ? path.resolve(process.env.STUDIO_PROJECT) : projectSettings(runtime).root || safePath(appRoot,path.join(appRoot,"workspaces/project")),
    inbox: safePath(
      studioRoot,
      process.env.STUDIO_INBOX || path.join(runtime, "inbox"),
    ),
    queueMode: "outbox" as "outbox" | "native",
    model: process.env.STUDIO_MODEL || undefined,
  };
}
export type Config = ReturnType<typeof configuration>;
// The Studio owns its CLI. Never inherit the caller's Desktop IPC, session,
// permission-profile or shell routing into an independent App Server.
export function codexEnvironment(
  home: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of Object.keys(env))
    if (key.startsWith("CODEX_")) delete env[key];
  env.CODEX_HOME = home;
  return env;
}
