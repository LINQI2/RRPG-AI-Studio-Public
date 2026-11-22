import React, {useLayoutEffect,useRef,useState} from "react";
import {BeijingTime} from "./beijing-time.js";
import {stateName} from "./presentation.js";
type Row=Record<string,any>;
const pageSize=5;
export function orderedExecutions(records:Row[]) {
  const at=(r:Row)=>{const created=Date.parse(r.createdAt||""),started=Date.parse(r.startedAt||"");return Number.isFinite(created)?created:Number.isFinite(started)?started:0;};
  return records.map((record,index)=>({record,index})).sort((a,b)=>at(a.record)-at(b.record)||a.index-b.index).map(x=>x.record);
}
export function ExecutionHistory({records,renderRecord}:{records:Row[];renderRecord:(record:Row)=>React.ReactNode}) {
  const sorted=orderedExecutions(records);
  const [open,setOpen]=useState(false),[startId,setStartId]=useState<string|null>(null),[unseen,setUnseen]=useState(false),[jump,setJump]=useState(0);
  const viewport=useRef<HTMLDivElement>(null),nearBottom=useRef(true),priorNewest=useRef<string|null>(null);
  const prepend=useRef<{height:number;top:number}|null>(null),forceBottom=useRef(false);
  const index=startId?sorted.findIndex(r=>r.id===startId):-1;
  const start=index>=0?index:Math.max(0,sorted.length-pageSize),shown=sorted.slice(start);
  const newest=sorted.at(-1)?.id||null;
  const toggle=()=>{
    if(!open){setStartId(sorted[Math.max(0,sorted.length-pageSize)]?.id||null);nearBottom.current=true;forceBottom.current=true;setUnseen(false);}
    setOpen(v=>!v);
  };
  const older=()=>{
    const box=viewport.current;if(!box||start<=0||prepend.current)return;
    prepend.current={height:box.scrollHeight,top:box.scrollTop};nearBottom.current=false;
    setStartId(sorted[Math.max(0,start-pageSize)].id);
  };
  const latest=()=>{setStartId(sorted[Math.max(0,sorted.length-pageSize)]?.id||null);nearBottom.current=true;forceBottom.current=true;setUnseen(false);setJump(v=>v+1);};
  useLayoutEffect(()=>{
    const box=viewport.current;if(!open||!box)return;
    if(prepend.current){box.scrollTop=prepend.current.top+box.scrollHeight-prepend.current.height;prepend.current=null;}
    else if(forceBottom.current||nearBottom.current){box.scrollTop=box.scrollHeight;forceBottom.current=false;nearBottom.current=true;}
    else if(priorNewest.current!==newest)setUnseen(true);
    priorNewest.current=newest;
  },[open,startId,records,jump,newest]);
  if(!records.length)return <p>本任务尚无 DSH 执行记录。</p>;
  return <section className="execution-history" aria-label="DSH 执行历史">
    <div className="execution-history-controls">
      <strong>DSH 执行记录 · 共 {sorted.length} 条</strong>
      <span>最近一次：{stateName(sorted.at(-1)?.status)}</span>
      <button type="button" aria-expanded={open} onClick={toggle}>{open?"收起执行记录":"展开执行记录"}</button>
      {open&&<button type="button" onClick={latest}>{unseen?"有新记录，查看最新":"回到最新记录"}</button>}
    </div>
    {open&&<>
      <p className="muted">最新在下，向上滚动加载更早记录。当前显示 {shown.length} / {sorted.length} 条；查看历史时不会强制跳到最新。</p>
      <div ref={viewport} className="execution-history-viewport" role="region" aria-label="DSH 执行记录滚动区域" tabIndex={0} onScroll={()=>{
        const box=viewport.current;if(!box)return;
        nearBottom.current=box.scrollHeight-box.scrollTop-box.clientHeight<48;
        if(nearBottom.current)setUnseen(false);
        if(box.scrollTop<24&&!forceBottom.current)older();
      }}>
        {start>0?<button type="button" className="execution-history-older" onClick={older}>加载更早记录（剩余 {start} 条）</button>:<p className="muted">已到最早记录</p>}
        {shown.map(j=><div key={j.id} className="execution-history-entry" data-execution-id={j.id}>
          <p className="muted">开始：<BeijingTime value={j.startedAt}/> · 记录更新：<BeijingTime value={j.updatedAt}/></p>
          {renderRecord(j)}
        </div>)}
      </div>
    </>}
  </section>;
}
