import { sdkRequestTimeout } from "./limits.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Row } from "../../shared/contracts.js";
import { processLease } from "./process-lease.js";

export interface DshConnection {
  request(method: string, params: Row): Promise<any>;
  close(): Promise<void>;
}
export interface DshInstallation {
  entry: string;
  protocol: string;
  version: string;
  entryHash: string;
}
export function checkInstallation(installation: DshInstallation) {
  if (
    !fs.existsSync(installation.entry) ||
    !fs.existsSync(installation.protocol)
  )
    throw Error("DSH 安装已移动或不存在；禁止自动下载替代版本");
  const actual = createHash("sha256")
    .update(fs.readFileSync(installation.entry))
    .digest("hex");
  if (actual !== installation.entryHash)
    throw Error("DSH 安装指纹变化，须先复核官方版本");
}
/** Thin transport adapter. Agent execution, persistence and descendants remain owned by DSH. */
export async function openSdk(options: {
  installation: DshInstallation;
  cwd: string;
  home: string;
  profile: string;
  env?: NodeJS.ProcessEnv;
  processLeaseName?: string;
  onEvent: (method: string, params: Row) => void;
}): Promise<DshConnection> {
  checkInstallation(options.installation);
  const { JsonRpcLineTransport } = await import(
    pathToFileURL(options.installation.protocol).href
  );
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATH",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, options.env, {
    DSH_HOME: options.home,
    DSH_PERMISSION_MODE: "workspace-write",
    DSH_MAX_TOKENS_AS_SUCCESS: "false",
    DSH_TELEMETRY_DISABLED: "1",
  });
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [options.installation.entry, "--profile", options.profile],
    {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let owned: ReturnType<ReturnType<typeof processLease>["create"]> | undefined;
  if (options.processLeaseName) {
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      owned = processLease(
        options.installation,
        options.processLeaseName,
      ).create(child.pid!);
    } catch (e) {
      child.kill();
      throw e;
    }
  }
  const rpc = new JsonRpcLineTransport(child.stdout, child.stdin);
  rpc.onNotification(options.onEvent);
  // Unsolicited host requests cannot become permission approvals.
  rpc.onRequest(async () => {
    throw Error("Studio 未授权额外权限或交互审批");
  });
  let diagnosticBytes = 0;
  child.stderr.on("data", (chunk: Buffer) => {
    if (diagnosticBytes < 65536) {
      fs.appendFileSync(
        options.home + "/private-stderr.log",
        chunk.subarray(0, 65536 - diagnosticBytes),
      );
      diagnosticBytes += chunk.length;
    }
  });
  child.stdin.on("error", () => rpc.close());
  child.on("error", (e) => {
    fs.appendFileSync(options.home + "/private-stderr.log", String(e));
    rpc.close();
  });
  child.on("exit", (code, signal) => {
    fs.appendFileSync(
      options.home + "/private-stderr.log",
      `\nDSH exit code=${code} signal=${signal}\n`,
    );
    rpc.close();
  });
  rpc.start();
  let closing: Promise<void> | undefined;
  return {
    request: (method, params) =>
      rpc.request(
        method,
        params,
        AbortSignal.timeout(sdkRequestTimeout(method)),
      ),
    close() {
      return (closing ??= (async () => {
        try {
          await rpc.request("shutdown", {}, AbortSignal.timeout(3000));
        } catch {
          /* outcome is reconciled from the durable job journal, never retried */
        }
        // Always stop the owned tree before permissions may be reclaimed.
        // Closing the Studio process also closes this kernel handle.
        if (owned) await owned.stop();
        rpc.close();
        if (child.exitCode === null)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 4000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("SDK exit not confirmed")),
              4000,
            );
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      })());
    },
  };
}
