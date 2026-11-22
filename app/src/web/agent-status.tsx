import {workPartition} from "./current-work.js";
import React from "react";
import {Raw,stateName,errorSummary} from "./presentation.js";
import {BeijingTime} from "./beijing-time.js";
import {readyForProducer} from "../shared/product.js";
type Row=Record<string,any>;
export function agentWork(agent:Row,snapshot:Row={}) {
  const partition=workPartition(snapshot);
  const tasks=partition.current.filter((t:Row)=>t.owner===agent.id);
  const historical=partition.historical.filter((t:Row)=>t.owner===agent.id);
  const ids=new Set(tasks.map((t:Row)=>t.id));
  const technical=(snapshot.decisions||[]).some((d:Row)=>d.status==='open'&&ids.has(d.taskId)&&(d.audience==='technical'||String(d.question||'').startsWith('【技术协助】')));
  const jobs=(snapshot.executions||[]).filter((j:Row)=>j.owner===agent.id||ids.has(j.taskId));
  const active=jobs.filter((j:Row)=>["preparing","dispatching","running","verifying","cancelling"].includes(j.status));
  const review=tasks.some((t:Row)=>t.status==="awaiting_acceptance"&&readyForProducer(t,(snapshot.deliveries||[]).filter((d:Row)=>d.taskId===t.id).at(-1)));
  const unknown=jobs.some((j:Row)=>j.status==="unknown")||(snapshot.messages||[]).some((m:Row)=>m.recipient===agent.id&&m.delivery==="unknown");
  const activity=jobs.map((j:Row)=>j.lastActivityAt).filter((v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v as string))).sort().at(-1);
  let state:string,next:string;
  if(active.length){state=active.every((j:Row)=>j.status==="verifying")?`正在验证 ${active.length} 项执行结果`:`DSH 正在执行 ${active.length} 项工作`;next="由负责人接收结果、核验成果并继续推进。";}
  else if(agent.status==="active"||agent.status==="dispatching"){state="负责人正在处理请求";next="等待负责人本轮回复或执行安排。";}
  else if(unknown){state="执行或投递结果待核对";next="由负责人和维护端核对原记录，暂不重复派发。";}
  else if(snapshot.dsh?.maintenance){state="维护暂停，当前没有执行";next="由维护端完成恢复核验，已有任务和指令保留。";}
  else if(agent.error||["error","unknown","requires-attention"].includes(agent.status)||agent.historyPartial===true){state="会话异常，推进情况需核对";next="由维护端处理会话连接或历史读取问题。";}
  else if(technical){state="等待技术问题处理，当前没有执行";next="已有技术协助请求，由负责人或维护端处理；无需重复发送继续任务。具体原因见技术协助区。";}
  else if(tasks.some((t:Row)=>t.status==="blocked")){state="当前没有执行，存在受阻任务";next="由负责人核对任务阻塞与恢复条件；详见任务树。";}
  else if((snapshot.messages||[]).some((m:Row)=>m.recipient===agent.id&&["recorded","accepted","queued_native","in_progress","dispatching"].includes(m.delivery))){state="指令等待负责人处理";next="核对原指令进展，不需要重复发送。";}
  else if(!tasks.length&&(snapshot.tasks||[]).some((t:Row)=>t.owner===agent.id&&t.status==="completed")){state="已登记专业交付，当前无执行";next="可查看最近成果和验证范围；不代表制作人已体验验收。";}
  else {state="当前没有执行中的工作";next=tasks.some((t:Row)=>!["completed","cancelled"].includes(t.status))?"任务尚未全部结束，下一步安排请看任务树；不能据空闲推断任务完成。":"可通过会话安排目标或交接已确认的设计文档。";}
  const leadActive=agent.status==="active";
  const runningLabel=active.length?`● 执行层正在处理 ${active.length} 项工作`:leadActive?"● 主开发/主策划正在处理请求，DSH 当前无活跃执行":unknown?"● 等待恢复：当前没有已确认的活跃执行":"○ 当前没有活跃执行";
  return {state,next,activity,review,historical,runningLabel,unknown,alert:unknown||!!agent.error||agent.historyPartial===true};
}
export function AgentStatus({agent,snapshot={}}:{agent:Row;snapshot?:Row}) {
  const yesNo=(v:unknown,yes:string,no:string)=>v===true?yes:v===false?no:"尚未确认";
  const work=agentWork(agent,snapshot);
  return <div className="agent-readable-status">
    <section aria-label="当前工作">
      <h3>当前工作</h3>
      <p role="status" aria-label="运行标志"><strong>{work.runningLabel}</strong></p>
      {work.unknown&&<p>上次结果仍待核对。这不代表 DSH 正在运行；负责人是否正在处理，请看上方运行标志。</p>}
      <p><strong>{work.state}</strong></p>
      {work.alert&&<p role="alert">存在待核对异常，不能据当前页面认定已恢复。</p>}
      <p>下一步：{work.next}</p>
      <p>需要你处理：{work.review?"有已整理的指定验收事项，请到任务页查看成果和判断范围。":"普通技术工作由负责人处理；如有产品决策或授权请求，请到制作人待办查看。"}</p>
      <p>最近 DSH 执行活动：<BeijingTime value={work.activity}/></p>
      <p>最近状态更新时间：<BeijingTime value={agent.updatedAt}/></p>
    </section>
    {work.historical.length>0&&<details><summary>已结束目标的遗留记录（{work.historical.length}）</summary><p>上级目标已结束，下级旧状态尚未收尾；不代表当前执行受阻，也未将旧失败改为成功。</p>{work.historical.map((t:Row)=><p key={t.id}>{t.title}：原记录{stateName(t.status)}。详见任务树，归属待负责人核对。</p>)}</details>}
    <details>
      <summary>维护诊断（通常无需查看）</summary>
      <p>以下配置供故障排查，不是待你处理的工作，也不代表已完成研发。</p>
      <dl>
        <dt>当前会话状态</dt><dd>{stateName(agent.status)}</dd>
        <dt>长期会话</dt><dd>{agent.threadId?"已绑定原有会话":"尚未绑定"}</dd>
        <dt>本轮处理</dt><dd>{agent.activeTurnId?"存在本轮处理记录；是否仍在执行以当前会话状态为准":"没有当前处理轮次记录"}</dd>
        <dt>最近核对会话</dt><dd><BeijingTime value={agent.lastObserved}/></dd>
        <dt>角色规则</dt><dd>{agent.instructionAppliedAt?"已有加载记录":"尚无加载记录"}，不等于已验证每次回答都符合规则</dd>
        <dt>角色规则加载时间</dt><dd><BeijingTime value={agent.instructionAppliedAt}/></dd>
        <dt>协作工具</dt><dd>{yesNo(agent.tools,"已配置","未配置")}</dd>
        <dt>历史读取</dt><dd>{yesNo(agent.historyPartial,"当前历史读取不完整","当前未标记为读取不完整")}</dd>
        <dt>持续目标</dt><dd>{agent.goal?stateName(agent.goal.status):"当前未记录持续目标"}</dd>
        <dt>本会话异常</dt><dd>{agent.error?errorSummary(String(agent.error)):"当前记录未报告异常；不代表研发测试全部通过"}</dd>
      </dl>
      <p className="muted">以上是负责人会话状态。是否正在修改文件或运行测试，请看任务中的 DSH 执行活动。</p>
      <Raw label="技术维护：原始会话数据（可选）" value={agent}/>
    </details>
  </div>;
}
