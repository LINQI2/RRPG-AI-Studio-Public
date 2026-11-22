import React from "react";
import {taskForest} from "../shared/task-tree.js";
import {readyForProducer} from "../shared/product.js";
import {taskProgress} from "./task-progress.js";
import {BeijingTime} from "./beijing-time.js";
import {Artifact,TaskOutcome} from "./product-views.js";
type Row=Record<string,any>;
const date=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value))?Date.parse(value):0;
export function outcomeGroups(snapshot:Row) {
  const tasks=snapshot.tasks||[], deliveries=snapshot.deliveries||[];
  const forest=taskForest(tasks,tasks.map((t:Row)=>t.id),tasks.length);
  const latest=(id:string)=>deliveries.filter((d:Row)=>d.taskId===id).sort((a:Row,b:Row)=>date(a.createdAt)-date(b.createdAt)||Number(a.version||0)-Number(b.version||0)).at(-1);
  return forest.roots.map((root:Row)=>{
    const family=[root,...forest.descendants(root.id)];
    const reports=family.map(task=>({task,delivery:latest(task.id)}));
    const versions=deliveries.filter((d:Row)=>family.some(t=>t.id===d.taskId));
    const recorded=family.some(t=>t.summary)||versions.length;
    return {root,family,reports,delivery:latest(root.id),versions:versions.length,recorded,
      lastReport:versions.map((d:Row)=>d.createdAt).filter((v:unknown)=>date(v)>0).sort((a:string,b:string)=>date(a)-date(b)).at(-1),
      sortAt:Math.max(0,...family.map(t=>date(t.updatedAt)),...versions.map((d:Row)=>date(d.createdAt)))};
  }).filter(g=>g.recorded).sort((a,b)=>b.sortAt-a.sortAt);
}
export function verificationSummary(task:Row,delivery?:Row) {
  const checks:Row[]=delivery?.checks||[];
  return {
    realPassed:checks.filter(c=>c.result==="passed"&&c.mode==="real"&&c.evidence?.length).length,
    nonReal:checks.filter(c=>c.mode==="analysis"||c.mode==="simulated").length,
    failed:checks.filter(c=>["failed","partial","blocked"].includes(c.result)).length,
    unverified:checks.filter(c=>c.result==="untested"||c.mode==="unknown"||(c.result==="passed"&&!c.evidence?.length)).length,
    missing:(task.contract?.requiredChecks||[]).filter((c:Row)=>!checks.some(x=>x.id===c.id&&x.result==="passed"&&x.mode===c.mode&&x.evidence?.length)).length,
    total:checks.length,
  };
}
export function RecentOutcomes({snapshot,onTask,open}:{snapshot:Row;onTask:(task:Row)=>void;open:(path:string)=>void}) {
  const groups=outcomeGroups(snapshot);
  return <section className="card" aria-label="最近成果">
    <h2>最近成果</h2>
    <p className="muted">按研发目标查看交付。阶段汇报、失败诊断与正式成果分别保留，不要求你逐条核对日志。</p>
    {!groups.length&&<p>尚无负责人提交的成果或阶段报告；执行中的工作请看当前工作与任务树。</p>}
    {groups.slice(0,4).map(group=>{
      const {root,delivery:d}=group, progress=taskProgress(root,snapshot),v=verificationSummary(root,d);
      return <article className="outcome-group" key={root.id} aria-label={root.title}>
        <h3>{root.title}</h3>
        <p><strong>当前进展：</strong>{progress.status}</p>
        <p><strong>实际交付：</strong>{d?`负责人已提交本目标交付；有 ${d.artifacts?.length||0} 项材料，仍须结合验证范围判断。`:`尚未提交本目标的完整成果；下级有 ${group.versions} 份阶段交付记录，不能代替整包交付。`}</p>
        <p><strong>验证结果：</strong>{!d?"尚无总目标的完整验证结论，下级通过或失败不自动代表整体结果。":!v.total?"交付未提供验证结论，不能认定已经通过。":`负责人报告：真实检查通过 ${v.realPassed} 项，失败/部分通过/受阻 ${v.failed} 项，未验证或缺证 ${v.unverified} 项；分析或模拟 ${v.nonReal} 项。以上是检查记录数，不是测试用例总数。`}</p>
        <p><strong>仍缺什么：</strong>{!d?"缺少总目标的可读交付、验证边界和下一步汇总。":v.missing?`本目标还有 ${v.missing} 项规定完成条件缺少对应通过证据。`:v.failed||v.unverified?"仍有失败、受阻或未验证记录，需负责人核对。":"没有从规定条件中发现缺项；已知问题仍以负责人交付说明为准，不据此自动验收。"}</p>
        <p><strong>下一步：</strong>{progress.next}</p>
        <p><strong>你需要做什么：</strong>{readyForProducer(root,d)&&root.status==="awaiting_acceptance"?"已有指定验收材料，请在制作人待办查看成果与具体判断问题。":"本区是成果与进展汇报，不代表需要你批准；决定与验收请求请看制作人待办。"}</p>
        <p>最近交付时间：<BeijingTime value={group.lastReport}/>{!d&&group.lastReport&&"（下级报告时间，不是整包完成时间）"}</p>
        {d&&<details><summary>阅读本目标的交付说明与材料</summary>
          <h4>负责人交付结论</h4><p className="message-content">{d.summary}</p>
          <h4>实际改动</h4><p className="message-content">{d.changes||"负责人未单独说明"}</p>
          <h4>已知问题</h4><p className="message-content">{d.issues||"未单独说明，不代表没有问题"}</p>
          <h4>负责人提出的下一步</h4><p className="message-content">{d.next}</p>
          {(d.artifacts||[]).map((a:Row,i:number)=><details key={i}><summary>{a.title}</summary><Artifact artifact={a} open={open}/></details>)}
        </details>}
        <details><summary>分项进展与阶段报告（{group.family.length-1} 个下级任务）</summary>
          {group.reports.map(({task,delivery}:Row)=><section className="outcome-part" key={task.id}>
            <h4>{task.id===root.id?"总任务":`分项：${task.title}`}</h4>
            <p>{taskProgress(task,snapshot).status}</p>
            <p>最近报告：<BeijingTime value={delivery?.createdAt}/></p>
            <p>{delivery?"这是该任务提交的报告，不自动代表总目标完成；后续进展请结合当前任务状态核对。":"尚无整理完整的交付报告；过程记录不当作正式成果。"}</p>
            <button onClick={()=>onTask(task)}>前往任务树查看此项</button>
            <details><summary>负责人原始报告与技术证据</summary><TaskOutcome task={task} snapshot={snapshot} open={open}/></details>
          </section>)}
        </details>
        <button onClick={()=>onTask(root)}>前往任务树</button>
      </article>;
    })}
  </section>;
}
