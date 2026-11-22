import fs from "node:fs";
import path from "node:path";
import { appRoot, safePath } from "../config.js";
import type { Row } from "../../shared/contracts.js";

// Private operator configuration, never accepted from a model/web request.
export interface ProjectWorkspaceGrant {
  root: string;
  authorization: string;
  taskIds: string[];
  taskTreeRoots?: string[];
  useUnity?: boolean;
  recoveryBaseline?: string;
}
export function projectGrant(value: any, configuredRoot: string): ProjectWorkspaceGrant | undefined {
  if (!value || value.enabled !== true) return;
  if (!path.isAbsolute(value.root || "") || !value.authorization?.trim() ||
      !Array.isArray(value.taskIds) || !value.taskIds.length ||
      value.taskIds.some((v: unknown) => typeof v !== "string" || !v))
    throw Error("工程执行授权缺少固定目录、任务范围或授权记录");
  if (value.taskTreeRoots !== undefined && (!Array.isArray(value.taskTreeRoots) || value.taskTreeRoots.some((id: unknown) => typeof id !== 'string' || !id))) throw Error('无效任务树授权');
  if (value.useUnity !== undefined && typeof value.useUnity !== 'boolean') throw Error('无效工程验证授权');
  const root = path.resolve(value.root);
  if (root.toLowerCase() !== path.resolve(configuredRoot).toLowerCase() ||
      fs.lstatSync(root).isSymbolicLink() ||
      fs.realpathSync(root).toLowerCase() !== root.toLowerCase())
    throw Error("工程执行授权与当前工程不符或经过重解析路径");
  return { root, authorization: value.authorization, taskIds: [...value.taskIds],
    taskTreeRoots: value.taskTreeRoots ? [...value.taskTreeRoots] : [], useUnity: value.useUnity === true,
    ...(value.recoveryBaseline ? { recoveryBaseline: value.recoveryBaseline } : {}) };
}
// Only operator-explicit task trees inherit. Ordinary organizational links grant nothing.
export function projectTaskGrant(task: Row, tasks: Row[], grant?: ProjectWorkspaceGrant): string | undefined {
  if (!grant || task.owner !== 'developer' || task.purpose !== 'product') return;
  if (grant.taskIds.includes(task.id)) return task.id;
  const seen = new Set<string>(); let current: Row | undefined = task;
  while (current && !seen.has(current.id)) {
    if (current.owner !== 'developer' || current.purpose !== 'product' || ['completed','cancelled'].includes(current.status)) return;
    seen.add(current.id);
    if (grant.taskTreeRoots?.includes(current.id)) return current.id;
    current = tasks.find(t => t.id === current!.parentTaskId);
  }
}
export function executionWorkspace(job: Row, grant?: ProjectWorkspaceGrant) {
  if (!job.projectAuthorization) return safePath(appRoot, job.workspace);
  if (!grant || job.projectAuthorization !== grant.authorization ||
      !(grant.taskIds.includes(job.taskId) || (job.projectGrantRootTaskId && grant.taskTreeRoots?.includes(job.projectGrantRootTaskId))) || job.owner !== "developer" ||
      job.shellMode !== "disabled" ||
      path.resolve(job.workspace).toLowerCase() !== grant.root.toLowerCase())
    throw Error("本任务工程文件授权无效；未启动 SDK 或修改权限");
  safePath(grant.root, job.workspace);
  if (fs.realpathSync(grant.root).toLowerCase() !== grant.root.toLowerCase())
    throw Error("工程根发生重解析变化");
  return grant.root;
}
