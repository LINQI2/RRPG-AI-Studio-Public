import { DSH_MODEL_BUDGET_MS } from "./limits.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { DshExecutor, pendingDshPolicy, type DshPolicy } from "./executor.js";
import { checkInstallation, openSdk, type DshInstallation } from "./sdk.js";
import type { Config } from "../config.js";
import { safePath, appRoot } from "../config.js";
import type { Store } from "../db.js";
import { WindowsWorkspaces, leaseName } from "./workspace.js";
import { executionRoleVersion } from "./policy.js";
import {baseRule} from '../rules.js';
import { verifyArtifact } from "./stages.js";
import { UnityConnection } from "../unity/connection.js";
import { unitySettings } from "../project-config.js";
import { executionWorkspace, projectGrant } from "./project-workspace.js";
import { installTestOwner } from "./test-owner.js";

/** Operator-owned local configuration; never exposed through an editable web endpoint. */
export function configuredDsh(store: Store, cfg: Config) {
  try {
    return configure(store, cfg);
  } catch {
    return new DshExecutor(store, cfg, {
      ...pendingDshPolicy,
      reason:
        "DSH 本机安装或配置校验失败；已停用 DSH，原 Codex 工作台继续可用。请维护者核对安装指纹与授权配置。",
    });
  }
}
function configure(store: Store, cfg: Config) {
  const file = path.join(cfg.runtime, "dsh-config.json");
  if (!fs.existsSync(file)) return new DshExecutor(store, cfg);
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (config.enabled !== true) return new DshExecutor(store, cfg);
  const installation: DshInstallation = config.installation;
  checkInstallation(installation);
  if (
    config.authorization !== "producer-approved-studio-20261022" ||
    config.provider !== "deepseek-account"
  )
    throw Error(
      "DSH 需要有效工作目录授权与现有账户渠道；禁止自动改用其他计费渠道",
    );
  const policy: DshPolicy = {
    allowed: true,
    source: "real",
    provider: config.provider,
    model: config.model || "deepseek-flash",
    projectWorkspace: projectGrant(config.projectWorkspace, cfg.project),
    maxRuntimeMs: DSH_MODEL_BUDGET_MS,
    managedShell:
      config.managedShell?.enabled === true &&
      config.managedShell.authorization ===
        "producer-approved-managed-workspace-20261022",
    reason:
      "制作人授权的独立工作目录执行；全局 Shell 关闭。可显式申请本次独立目录的原生 Shell；Windows ACL 非完整读取或网络隔离。无金额硬上限，不自动重试、不自动创建付费子 Agent。",
  };
  if (config.shellEnabled !== false)
    throw Error("Global Shell must remain disabled");
  const lifecycle = policy.managedShell
    ? new WindowsWorkspaces(cfg, installation, config.managedShell.pwsh)
    : undefined;
  const unity = new UnityConnection(cfg);
  return new DshExecutor(
    store,
    cfg,
    policy,
    async (job, onEvent) => {
      const executionRole=baseRule('dsh',cfg.rulesRoot);
      safePath(appRoot, job.home);
      executionWorkspace(job, policy.projectWorkspace);
      const profile = path.join(job.home, "profiles/sdk");
      fs.mkdirSync(profile, { recursive: true });
      fs.writeFileSync(
        path.join(profile, "package.json"),
        JSON.stringify({
          private: true,
          dsh: {
            profile: {
              bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-sdk-app"],
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(profile, "cordis.patch.yml"),
        "- id: approval\n  config:\n    policy: never\n- id: permission\n  config:\n    defaultPreset: workspace-only\n    presets:\n      workspace-only:\n        sandbox: workspace-write\n        approval: never\n",
      );
      fs.appendFileSync(
        path.join(profile, "cordis.patch.yml"),
        "- id: system-prompt\n  config:\n    personaPrefix: " +
          JSON.stringify(executionRole) +
          "\n" +
          [
            "tool-subagent",
            "tool-subagent-fork",
            "tool-subagent-control",
            "tool-subagent-list-agents",
            "tool-workflow",
            "tool-goal",
            "command-goal",
            "goal-round-driver",
          ]
            .map((id) => `- id: ${id}\n  disabled: true\n`)
            .join(""),
      );
      store.update("executions", job.id, {
        executionRoleVersion,
        executionRoleHash: createHash("sha256")
          .update(executionRole)
          .digest("hex"),
      });
      const shell =
        job.shellMode === "managed" && policy.managedShell && !job.recoveryOnly;
      if (!shell)
        fs.appendFileSync(
          path.join(profile, "cordis.patch.yml"),
          "- id: tool-pwsh\n  disabled: true\n- id: tool-bash\n  disabled: true\n- id: tool-jobs\n  disabled: true\n",
        );
      if (job.useUnity && !job.recoveryOnly) {
        const owner = installTestOwner(profile, job.home, Boolean(job.projectAuthorization));
        job.testOwnerReceipt = owner.receipt;
        fs.appendFileSync(path.join(profile, "cordis.patch.yml"),
          "\n- insert:\n    - id: studio-test-owner\n      name: " + JSON.stringify(owner.pluginUrl) + "\n");
        const u = unitySettings(cfg);
        if (!u.allowExecution) throw Error("MCP执行尚未授权");
        fs.appendFileSync(
          path.join(profile, "cordis.patch.yml"),
          "\n- insert:\n    - id: studio-unity\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: streamable-http\n        serverName: studio-unity\n        url: " +
            JSON.stringify(u.endpoint) +
            "\n        toolCallTimeoutMs: 45000\n        failOnStartupError: true\n        headers:\n          Authorization: " +
            JSON.stringify("Bearer " + u.token) +
            "\n",
        );
      }
      // Isolate refresh/revocation writes from the producer's original DSH home.
      // Credentials remain private runtime material and are never part of evidence exports.
      const credential = path.join(job.home, ".credentials.yaml");
      if (!fs.existsSync(credential))
        fs.copyFileSync(
          path.join(os.homedir(), ".dsh/.credentials.yaml"),
          credential,
          fs.constants.COPYFILE_EXCL,
        );
      return openSdk({
        installation,
        cwd: job.workspace,
        home: job.home,
        profile: "sdk",
        onEvent,
        ...(shell
          ? {
              processLeaseName: leaseName(job.sessionId),
              env: {
                TEMP: path.join(job.directoryRoot, "temp"),
                TMP: path.join(job.directoryRoot, "temp"),
                TMPDIR: path.join(job.directoryRoot, "temp"),
              },
            }
          : {}),
      });
    },
    lifecycle,
    async (job, stage) =>
      stage.check?.kind === "unity-tests"
        ? unity.verify(job, stage)
        : verifyArtifact(job, stage),
    unity,
  );
}
export const fileHash = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
