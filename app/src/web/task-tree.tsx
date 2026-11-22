import React, { useEffect, useState } from "react";
import { taskForest } from "../shared/task-tree.js";
import { taskProgress, taskTimes } from "./task-progress.js";
import { TaskTimes } from "./task-times.js";
type Row = Record<string, any>;
export function TaskTree({snapshot,matched,limit,renderDetails,focusId}:{snapshot:Row;matched:string[];limit:number;renderDetails:(task:Row)=>React.ReactNode;focusId?:string}) {
  const [branches,setBranches]=useState<Record<string,boolean>>({});
  const [details,setDetails]=useState<Record<string,boolean>>({});
  const forest=taskForest(snapshot.tasks,matched,limit);
  useEffect(()=>{
    if(!focusId||!forest.byId.has(focusId))return;
    const ancestors:Record<string,boolean>={};let p=forest.parent.get(focusId);while(p){ancestors[p]=true;p=forest.parent.get(p);}
    setBranches(v=>({...v,...ancestors}));setDetails(v=>({...v,[focusId]:true}));
  },[focusId]);
  const filtered=matched.length!==snapshot.tasks.length;
  function node(t:Row,depth:number):React.ReactNode {
    const direct=forest.children.get(t.id)||[];
    const descendants=forest.descendants(t.id);
    const visible=direct.filter(c=>forest.visible.has(c.id));
    const open=branches[t.id] ?? filtered;
    const allIds=new Set([t.id,...descendants.map(c=>c.id)]);
    const jobs=(snapshot.executions||[]).filter((j:Row)=>allIds.has(j.taskId));
    const working=jobs.filter((j:Row)=>["preparing","dispatching","running","verifying","cancelling"].includes(j.status)).length;
    const ownProgress=taskProgress(t,snapshot);
    const heading=working>0&&(!ownProgress.active||["completed","cancelled"].includes(t.status))
      ? (["completed","cancelled"].includes(t.status)?`${ownProgress.status}；下级仍有执行，需核对`:"下级 DSH 执行中，负责人等待结果")
      : ownProgress.status;
    const recent=[t,...descendants].flatMap(c=>{const times=taskTimes(c,snapshot);return [times.updated,times.activity];}).filter(Boolean).sort().at(-1);
    const detailId=`task-detail-${t.id}`,childId=`task-children-${t.id}`;
    return <div className="task-node" key={t.id}>
      <section className="card task-card" data-task-id={t.id}>
        <div className="task-summary">
          <span className="task-summary-title">{t.title}</span>
          <span className="task-summary-meta">{t.owner==="planner"?"主策划":"主开发"} · {heading}</span>
          <span className="task-summary-brief">{depth===0?"顶层任务":"子任务"}{t.parentTaskId && forest.byId.has(t.parentTaskId) && ` · 上级：${forest.byId.get(t.parentTaskId)?.title}`}{!forest.parent.get(t.id)&&t.parentTaskId&&" · 原上级关系异常，待核对"}</span>
          {descendants.length>0 && <span className="task-summary-brief" aria-label="子任务概况">直属子任务 {direct.length} 个 · 全部下级 {descendants.length} 个 · 本任务及下级活跃执行 {working} 个<br />本任务及下级最近变化：{recent?<time dateTime={recent}>{new Date(recent).toLocaleString("zh-CN",{hour12:false})}</time>:"未记录"}（含记录更新与原生DSH活动，不代表全部完成）</span>}
          <TaskTimes task={t} snapshot={snapshot}/>
          <div className="actions">
            {direct.length>0 && <button type="button" aria-expanded={open} aria-controls={childId} onClick={()=>setBranches(v=>({...v,[t.id]:!open}))}>{open?"收起子任务":"展开子任务"}（{direct.length}）</button>}
            <button type="button" aria-expanded={!!details[t.id]} aria-controls={detailId} onClick={()=>setDetails(v=>({...v,[t.id]:!v[t.id]}))}>{details[t.id]?"收起详情":"查看详情"}</button>
          </div>
        </div>
        {details[t.id] && <div id={detailId}>{renderDetails(t)}</div>}
      </section>
      {direct.length>0 && open && <div id={childId} className="task-children" aria-label={`${t.title}的子任务`}>
        {visible.map(c=>node(c,depth+1))}
        {!visible.length&&<p>当前筛选或加载范围内没有子任务；可清除筛选或加载更多。</p>}
        {visible.length<direct.length&&visible.length>0&&<p>部分子任务不在当前筛选或加载范围内。</p>}
      </div>}
    </div>;
  }
  return <div aria-label="研发任务树">{forest.roots.map(t=>node(t,0))}</div>;
}
