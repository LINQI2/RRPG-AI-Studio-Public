import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { Row } from "../../shared/contracts.js";
import { appRoot, safePath, type Config } from "../config.js";
import type { DshInstallation } from "./sdk.js";
import { processLease } from "./process-lease.js";

export interface WorkspaceLifecycle {
  prepare(job: Row): Promise<void>;
  cleanup(job: Row): Promise<void>;
  recover(): Promise<{ sessionId: string; error?: string }[]>;
}
export const managedRoot = () => path.join(appRoot, "workspaces/executions");
export const leaseName = (sessionId: string) =>
  `Local\\RRPG-Studio-${sessionId}`;

export class WindowsWorkspaces implements WorkspaceLifecycle {
  readonly root = managedRoot();
  readonly journals: string;
  readonly official: string;
  readonly native: string;
  constructor(
    readonly cfg: Config,
    readonly installation: DshInstallation,
    readonly pwsh: string,
  ) {
    this.journals = path.join(cfg.runtime, "managed-shell");
    const packages = path.resolve(path.dirname(installation.entry), "../../");
    this.native = path.join(packages, "dsh-sandbox-windows-acl/lib/index.js");
    this.official = path.join(
      packages,
      "dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1",
    );
    for (const p of [pwsh, this.native, this.official])
      if (!fs.existsSync(p))
        throw Error("Verified Windows lifecycle dependency missing");
    this.noLinks(this.root);
    this.noLinks(this.journals);
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.journals, { recursive: true });
  }
  private noLinks(target: string) {
    safePath(appRoot, target);
    for (let p = path.resolve(target); ; p = path.dirname(p)) {
      if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink())
        throw Error("Reparse paths cannot receive managed permissions");
      if (p === appRoot) break;
      if (path.dirname(p) === p) throw Error("Not inside Studio");
    }
  }
  private paths(job: Row) {
    if (
      !/^rrpg-dsh-[0-9a-f-]{36}$/.test(job.sessionId) ||
      path.resolve(job.workspace) !==
        path.join(this.root, job.sessionId, "work")
    )
      throw Error("Only a fresh Studio-managed workspace is authorized");
    this.noLinks(job.workspace);
    const journal = path.join(this.journals, job.sessionId);
    this.noLinks(journal);
    return { workspace: path.join(this.root, job.sessionId), journal };
  }
  private state(job: Row, state: string, error?: string) {
    const { journal } = this.paths(job),
      file = path.join(journal, "lease.json");
    const prior = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {};
    const record = {
      ...prior,
      sessionId: job.sessionId,
      workspace: job.workspace,
      directoryRoot: path.dirname(job.workspace),
      jobId: job.id,
      processLease: leaseName(job.sessionId),
      state,
      error,
      at: new Date().toISOString(),
      ...(state === "native-grant" ? { nativeGrantStarted: true } : {}),
      ...(state === "native-revoked" ? { nativeRevoked: true } : {}),
    };
    fs.writeFileSync(file + ".tmp", JSON.stringify(record, null, 2));
    fs.renameSync(file + ".tmp", file);
  }
  private async helper(job: Row, operation: string) {
    const { workspace, journal } = this.paths(job);
    const child = spawn(
      this.pwsh,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(appRoot, "scripts/dsh-workspace.ps1"),
        "-Operation",
        operation,
        "-Workspace",
        workspace,
        "-Journal",
        journal,
        "-OfficialScript",
        this.official,
        "-WaitForLease",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let guard:
      ReturnType<ReturnType<typeof processLease>["create"]> | undefined;
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b.toString();
      if (stdout.length > 4 * 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
      if (stderr.length > 4 * 1024 * 1024) child.kill();
    });
    child.stdin.on("error", () => {});
    const settled = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      guard = processLease(
        this.installation,
        leaseName(job.sessionId) + "-permissions",
      ).create(child.pid!);
      child.stdin.end("LEASE_READY\n");
      const code = await Promise.race([
        settled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Permission helper timed out")),
            120000,
          );
        }),
      ]);
      if (code !== 0)
        throw Error(`Permission ${operation} exit=${code}: ${stderr}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (guard) await guard.stop();
      else child.kill();
      fs.appendFileSync(
        path.join(journal, "lifecycle.log"),
        `${operation}\n${stdout}\n${stderr}\n`,
      );
    }
    const r = { stdout, stderr };
    return r;
  }
  async prepare(job: Row) {
    const { journal } = this.paths(job);
    fs.mkdirSync(journal); // Existing journals are recovery, never fresh provisioning.
    this.state(job, "snapshot");
    await this.helper(job, "snapshot");
    this.state(job, "preparing");
    try {
      const r = await this.helper(job, "repair");
      fs.writeFileSync(
        path.join(journal, "official.log"),
        r.stdout + "\n" + r.stderr,
      );
      await this.helper(job, "configure");
      this.state(job, "native-grant");
      const { AclWriteGrant, workspaceWriteSid } = await import(
        pathToFileURL(this.native).href
      );
      const grant = AclWriteGrant.create(workspaceWriteSid(job.workspace));
      try {
        grant.add(job.workspace, true);
      } finally {
        grant.dispose();
      }
      this.state(job, "ready");
    } catch (e) {
      this.state(job, "recovery-required", String(e));
      throw e;
    }
  }
  async cleanup(job: Row) {
    const { journal } = this.paths(job);
    if (!fs.existsSync(journal)) return; // No preparation was started.
    const record = JSON.parse(
      fs.readFileSync(path.join(journal, "lease.json"), "utf8"),
    );
    if (record.state === "released") return;
    // A crash closes the kill-on-close Job. A live lease is never guessed away.
    await processLease(this.installation, leaseName(job.sessionId)).recover();
    await processLease(
      this.installation,
      leaseName(job.sessionId) + "-permissions",
    ).recover();
    if (!fs.existsSync(path.join(journal, "baseline.json"))) {
      if (record.state !== "snapshot")
        throw Error("Missing permission baseline; manual review required");
      this.state(job, "released");
      return; // Snapshot refused before any mutation.
    }
    this.state(job, "releasing");
    try {
      if (record.nativeGrantStarted && !record.nativeRevoked) {
        const { AclWriteGrant, workspaceWriteSid, tempWriteSid } = await import(
          pathToFileURL(this.native).href
        );
        const grant = AclWriteGrant.create(workspaceWriteSid(job.workspace));
        try {
          grant.add(job.workspace, false);
        } finally {
          grant.dispose();
        }
        // Native private temps are confined beneath this lease, never the user's TEMP.
        const tempRoot = path.join(path.dirname(job.workspace), "temp");
        for (const name of fs.readdirSync(tempRoot)) {
          const target = path.join(tempRoot, name);
          this.noLinks(target);
          if (
            !/^dsh-[A-Za-z0-9]+$/.test(name) ||
            !fs.statSync(target).isDirectory()
          )
            continue;
          const temp = AclWriteGrant.create(tempWriteSid(target));
          try {
            temp.add(target, false);
          } finally {
            temp.dispose();
          }
        }
        this.state(job, "native-revoked");
      }
      await this.helper(job, "cleanup");
      this.state(job, "released");
    } catch (e) {
      this.state(job, "recovery-required", String(e));
      throw e;
    }
  }
  async recover() {
    const results: { sessionId: string; error?: string }[] = [];
    for (const entry of fs.readdirSync(this.journals)) {
      if (!/^rrpg-dsh-[0-9a-f-]{36}$/.test(entry)) continue;
      const file = path.join(this.journals, entry, "lease.json");
      try {
        this.noLinks(file);
        const record = JSON.parse(fs.readFileSync(file, "utf8"));
        if (record.sessionId !== entry) throw Error("Lease identity mismatch");
        if (record.state === "released") continue;
        await this.cleanup({ ...record, id: record.jobId });
        results.push({ sessionId: entry });
      } catch (e) {
        results.push({ sessionId: entry, error: String(e) });
      }
    }
    return results;
  }
}
