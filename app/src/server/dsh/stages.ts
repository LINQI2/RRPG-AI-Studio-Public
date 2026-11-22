import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { safePath } from "../config.js";
import type { Row } from "../../shared/contracts.js";
import type { ExecutionStage } from "./policy.js";

export type StageVerifier = (job: Row, stage: ExecutionStage) => Promise<Row>;
export async function verifyArtifact(
  job: Row,
  stage: ExecutionStage,
): Promise<Row> {
  if (!stage.check)
    return {
      passed: true,
      mode: "execution-only",
      note: "原生阶段结束，未独立验证成果",
    };
  if (stage.check.kind !== "artifact")
    throw Error("此任务未启用指定的可信验证入口");
  const file = safePath(
    job.workspace,
    path.resolve(job.workspace, stage.check.path),
  );
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 2000000)
    throw Error("成果不是有效的小型文件");
  const bytes = fs.readFileSync(file);
  return {
    passed: true,
    mode: "artifact-presence",
    path: stage.check.path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    note: "仅核验文件存在与指纹，不代表文件内容或测试真实通过",
  };
}
