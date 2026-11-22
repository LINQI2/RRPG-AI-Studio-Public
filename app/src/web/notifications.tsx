import React,{useEffect,useMemo,useRef,useState} from "react";
import {decisionAudience} from "../shared/decision-routing.js";
import {readyForProducer} from "../shared/product.js";
import {BeijingTime} from "./beijing-time.js";
type Row=Record<string,any>;
export type Notice={id:string;kind:"decision"|"request"|"acceptance"|"reply"|"delivery";title:string;at?:string;owner?:string;taskId?:string;critical:boolean};
export function notificationItems(s:Row):Notice[]{
  const result:Notice[]=[];
  const name=(id:string)=>id==="planner"?"主策划":"主开发";
  for(const d of s.decisions||[])if(d.status==="open"&&decisionAudience(d)!=="technical")result.push({id:`decision:${d.id}`,kind:"decision",title:decisionAudience(d)==="unclassified"?"有历史请求待明确处理责任":`${name(d.owner)}需要你作出决定`,at:d.createdAt,owner:d.owner,taskId:d.taskId,critical:true});
  for(const r of s.requests||[])if(r.status==="open")result.push({id:`request:${r.id}`,kind:"request",title:`${name(r.owner)}有需要答复的问题`,at:r.createdAt,owner:r.owner,critical:true});
  for(const t of s.tasks||[]){const d=(s.deliveries||[]).filter((d:Row)=>d.taskId===t.id).at(-1);if(t.status==="awaiting_acceptance"&&readyForProducer(t,d))result.push({id:`acceptance:${t.id}:${d.id}`,kind:"acceptance",title:`等待验收：${t.title}`,at:d.createdAt,taskId:t.id,owner:t.owner,critical:true});}
  for(const m of (s.messages||[]).filter((m:Row)=>m.recipient==="producer"&&m.nativeItemId&&m.phase==="final_answer").slice(-20))result.push({id:`reply:${m.id}`,kind:"reply",title:`${name(m.sender)}发来了回复`,at:m.createdAt,taskId:m.taskId,owner:m.sender,critical:false});
  const latest=new Map<string,Row>();for(const d of s.deliveries||[])latest.set(d.taskId,d);
  for(const [taskId,d] of latest){const t=(s.tasks||[]).find((t:Row)=>t.id===taskId);if(!t||result.some(n=>n.kind==="acceptance"&&n.taskId===taskId))continue;result.push({id:`delivery:${d.id}`,kind:"delivery",title:`${name(t.owner)}提交了工作报告`,at:d.createdAt,taskId,owner:t.owner,critical:false});}
  return result.sort((a,b)=>(Date.parse(b.at||"")||0)-(Date.parse(a.at||"")||0));
}
export function NotificationCenter({snapshot,onOpen}:{snapshot:Row|null;onOpen:(notice:Notice)=>void}){
  const items=useMemo(()=>snapshot?notificationItems(snapshot):[],[snapshot]);
  const [open,setOpen]=useState(false),[read,setRead]=useState<Record<string,boolean>>({}),[sound,setSound]=useState(false),[desktop,setDesktop]=useState(false),[feedback,setFeedback]=useState(""),[toast,setToast]=useState<Notice|null>(null);
  const initialized=useRef<string|null>(null),observed=useRef(new Set<string>()),audio=useRef<AudioContext|null>(null);
  const root=useRef<HTMLDivElement>(null);
  const epoch=snapshot?.dataEpoch||"default",storage=`studio-notifications:${epoch}`;
  const save=(v:Record<string,boolean>)=>{try{localStorage.setItem(storage,JSON.stringify(v));}catch{setFeedback("浏览器未能保存已读标记，本页仍可查看通知。");}};
  const ping=()=>{try{const c=audio.current;if(!c||c.state!=="running")return;const o=c.createOscillator(),g=c.createGain();o.frequency.value=660;g.gain.setValueAtTime(.06,c.currentTime);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.12);}catch{setFeedback("声音未能播放，红点与页面提醒仍可用。");}};
  useEffect(()=>{
    if(!snapshot)return;
    if(initialized.current!==epoch){
      let stored:Record<string,boolean>={},first=true;try{const saved=localStorage.getItem(storage);first=saved===null;stored=JSON.parse(saved||"{}");}catch{/* Keep actionable unread. */}
      if(!stored||typeof stored!=="object"||Array.isArray(stored))stored={};
      // Existing chat/report history does not become a burst of new notifications.
      if(first)for(const n of items)if(!n.critical&&stored[n.id]===undefined)stored[n.id]=true;
      initialized.current=epoch;observed.current=new Set(items.map(n=>n.id));setRead(stored);save(stored);return;
    }
    const fresh=items.filter(n=>!observed.current.has(n.id));for(const n of fresh)observed.current.add(n.id);
    if(!fresh.length)return;
    const n=fresh.find(n=>n.critical)||fresh[0];setToast(n);
    if(sound)ping();
    if(desktop&&typeof Notification!=="undefined"&&Notification.permission==="granted")try{const notice=new Notification("RRPG AI Studio",{body:n.title,tag:n.id});notice.onclick=()=>{window.focus();view(n);notice.close();};}catch{setFeedback("系统通知未能显示，页面红点仍保留。");}
  },[snapshot,items,epoch]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),8000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>()=>{void audio.current?.close();},[]);
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};document.addEventListener("pointerdown",close);document.addEventListener("keydown",key);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",key);};},[open]);
  const unread=items.filter(n=>!read[n.id]);
  const view=(n:Notice)=>{setRead(old=>{const next={...old,[n.id]:true};save(next);return next;});setToast(null);setOpen(false);onOpen(n);};
  return <div className="notification-center" ref={root}>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} aria-label={`通知，${unread.length}条未读`}>通知 {unread.length>0&&<span className="notification-dot">{unread.length}</span>}</button>
    {open&&<section className="notification-panel card" aria-label="消息通知">
      <div className="actions"><h3>消息通知</h3><button onClick={()=>setOpen(false)}>关闭通知</button><button onClick={()=>setRead(old=>{const next={...old};for(const n of items)next[n.id]=true;save(next);return next;})}>标记当前通知已读</button></div>
      <p className="muted">看过不等于批准或验收。普通工具日志和技术协助不生成制作人红点。</p>
      <div className="actions"><button onClick={async()=>{if(sound){setSound(false);return;}try{audio.current ||=new AudioContext();await audio.current.resume();if(audio.current.state!=="running")throw Error();setSound(true);ping();setFeedback("本页声音提醒已开启。");}catch{setFeedback("浏览器未允许声音，请保留红点提醒。");}}}>{sound?"关闭声音提醒":"开启声音提醒"}</button>
      <button onClick={async()=>{if(desktop){setDesktop(false);return;}if(typeof Notification==="undefined"){setFeedback("此浏览器不支持系统通知，红点与页面提醒仍可用。");return;}try{const permission=await Notification.requestPermission();setDesktop(permission==="granted");setFeedback(permission==="granted"?"本页系统通知已开启。":"系统通知未获允许，仍保留页面提醒。");}catch{setFeedback("系统通知申请失败，仍保留页面提醒。");}}}>{desktop?"关闭系统通知":"开启系统通知"}</button></div>
      <p className="muted">声音和系统通知需在本页手动开启；网页关闭后不保证提醒。</p>
      {feedback&&<p role="status">{feedback}</p>}
      <div className="notification-list">{items.length?items.map(n=><article key={n.id} className="notification-item"><strong>{!read[n.id]&&"● "}{n.title}</strong><p><BeijingTime value={n.at}/></p><button onClick={()=>view(n)}>查看此项</button></article>):<p>当前没有消息通知。</p>}</div>
    </section>}
    {toast&&<div className="notification-toast" role="status"><strong>{toast.title}</strong><button onClick={()=>view(toast)}>去查看</button><button onClick={()=>setToast(null)}>关闭提醒</button></div>}
  </div>;
}
