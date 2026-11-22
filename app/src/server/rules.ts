import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {studioRoot, safePath, type Config} from './config.js';
import {StudioError, type Row} from '../shared/contracts.js';
import type {Store} from './db.js';
export const rulesRoot=path.join(studioRoot,'rules');
export const ruleHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const roleIds=['planner','developer'] as const;
const names:Record<string,string>={planner:'主策划',developer:'主开发',dsh:'DSH 执行层'};
function roleId(id:string){if(!roleIds.includes(id as any))throw new StudioError('仅支持主策划和主开发的补充要求',400);return id;}
function read(root:string,relative:string){
  const file=safePath(root,path.join(root,relative));
  if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>100000)throw new StudioError('规则文件不是有效的小型文本',400);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));}
  catch{throw new StudioError('规则文件必须是有效的UTF-8文本，未加载替代内容',400);}
}
export function baseRule(id:string,root=rulesRoot){
  if(!['planner','developer','dsh'].includes(id))throw new StudioError('未知角色',400);
  const text=read(root,`roles/${id}.md`);
  if(!text.trim())throw new StudioError('基础角色规则不能为空，未启动对话',400);
  return text;
}
export function leadRule(id:string,root=rulesRoot){
  roleId(id);const base=baseRule(id,root),extra=read(root,`preferences/${id}.md`).trim();
  const protocol=read(root,`protocols/${id}.md`).trim();
  if(!protocol)throw new StudioError(`${names[id]}工具协议不能为空，未启动对话`,400);
  return base+(protocol?`\n\n${protocol}`:'')+(extra?`\n\n制作人补充要求（适用于后续工作；不改变程序权限、工程授权或验收事实）：\n${extra}`:'');
}
export function rulesView(store:Store,cfg:Config){
  const root=cfg.rulesRoot||rulesRoot;
  const roles=['planner','developer','dsh'].map(id=>{
    const baseText=baseRule(id,root),editable=id!=='dsh',supplement=editable?read(root,`preferences/${id}.md`):'';
    const text=editable?leadRule(id,root):baseText,a=store.get('agents',id);
    const turnLatest=Date.parse(a?.lastTurnRuleAt||'')>=Date.parse(a?.instructionAppliedAt||'')||!a?.instructionContentHash;
    const appliedHash=turnLatest?a?.lastTurnRuleHash:a?.instructionContentHash;
    return {id,title:names[id],baseText,basePath:path.join(root,`roles/${id}.md`),supplement,
      protocolText:editable?read(root,`protocols/${id}.md`):null,
      protocolPath:editable?path.join(root,`protocols/${id}.md`):null,
      supplementPath:editable?path.join(root,`preferences/${id}.md`):null,editable,
      revision:ruleHash(supplement),baseVersion:id==='dsh'?'2026-10-23-scoped-unity-saves':'2026-10-24-decision-routing',effectiveHash:ruleHash(text),appliedHash:appliedHash||null,
      appliedAt:(turnLatest?a?.lastTurnRuleAt:a?.instructionAppliedAt)||null,turnActive:a?.status==='active',
      applicationStatus:id==='dsh'?'新执行任务加载；已运行的Session不变':appliedHash===ruleHash(text)?'已随会话或对话指令发送，不等于已验证模型遵守':'待后续正常对话发送；保存不会启动模型'};
  });
  return {root,roles,skills:[{title:'Studio 专用技能',description:'目前没有在此目录注册并自动加载的专用Skill。目录提供维护入口，放入文件不等于已启用。Codex/DSH内置技能与插件另由其运行环境管理。',path:path.join(root,'skills','README.md'),content:read(root,'skills/README.md'),loaded:false}],
    harnessGuide:{path:path.join(root,'harness/README.md'),content:read(root,'harness/README.md')},
    harness:[{title:'任务派发与结果记录',description:'程序负责身份、派发去重和执行状态，角色文字不能替代这些检查。',source:path.join(studioRoot,'app/src/server/studio.ts')},
      {title:'DSH 执行与验证',description:'官方SDK执行、阶段检查和结果持久化；当前测试失败会交回负责人，未实现同Session自动修复闭环。',source:path.join(studioRoot,'app/src/server/dsh/executor.ts')},
      {title:'Unity 工程与测试保护',description:'手动打开工程、核对身份、独占执行、保存真实测试回执；修改角色要求不会改工程权限。',source:path.join(studioRoot,'app/src/server/unity/connection.ts')} ]};
}
export function saveSupplement(store:Store,cfg:Config,id:string,content:string,expectedRevision:string){
  roleId(id);if(typeof content!=='string'||content.length>8000||content.includes('\0'))throw new StudioError('补充要求最多8000字，不能包含空字符',400);
  const root=cfg.rulesRoot||rulesRoot,relative=`preferences/${id}.md`,old=read(root,relative);
  if(ruleHash(old)!==expectedRevision)throw new StudioError('规则已被其他操作修改，请重新读取后合并，未覆盖原内容',409);
  if(old===content)return rulesView(store,cfg);
  const target=safePath(root,path.join(root,relative));
  const dir=safePath(cfg.runtime,path.join(cfg.runtime,'rule-backups'));fs.mkdirSync(dir,{recursive:true});
  const key=`${Date.now()}-${randomUUID()}-${id}`,backup=path.join(dir,key+'.md');
  fs.writeFileSync(backup,old,{flag:'wx'});
  // Same directory rename gives readers either the old or the complete new file.
  const temp=target+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,content,{flag:'wx'});if(ruleHash(read(root,relative))!==expectedRevision)throw new StudioError('保存期间规则已变化，未覆盖',409);fs.renameSync(temp,target);}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  store.atomic(()=>{store.event('rules.supplement_saved',{role:id,before:ruleHash(old),after:ruleHash(content),backup,scope:'future-turns',doesNotStartModel:true});});
  return rulesView(store,cfg);
}
