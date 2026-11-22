import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
export function installTestOwner(profile: string, home: string, protectProject = false) {
  const plugin = path.join(profile, "studio-test-owner.mjs");
  const receipt = path.join(home, "test-owner-active.json");
  // Use the installed official registry's monotonic guard. No custom shell,
  // test executor or alternate sandbox is introduced.
  fs.writeFileSync(plugin, `import fs from 'node:fs';
export const name='studio-test-owner'; export const inject=['tools'];
export function apply(ctx) {
 if(typeof ctx.tools.guard!=='function') throw Error('Official tool guard unavailable');
 const blocked='mcp__studio-unity__tests-run';
 const globalMutationSaveBlocked=${JSON.stringify(protectProject)};
 ctx.tools.guard(call=>call.name===blocked?'Unity测试由Studio持久测试阶段执行；请提交stages.check，勿从DSH直接启动。':
   globalMutationSaveBlocked && call.name==='mcp__studio-unity__rql-mutate' ? '受保护工程禁止rql-mutate：当前插件会自动保存全部dirty资产/场景，连RefreshAssets也会顺带落盘。请用script-execute调用AssetDatabase.Refresh；只用SaveAssetIfDirty/PrefabUtility等定向保存本任务资产，不调用SaveAssets/SaveChanges。' : undefined);
 fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({version:1,pid:process.pid,blocked,globalMutationSaveBlocked}));
}
`);
  return { pluginUrl: pathToFileURL(plugin).href, receipt };
}
