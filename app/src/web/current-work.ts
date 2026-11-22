type Row=Record<string,any>;
export function workPartition(snapshot:Row){
 const tasks:Row[]=snapshot.tasks||[],byId=new Map(tasks.map(t=>[t.id,t]));
 const historical=tasks.filter(t=>{
  if(["completed","cancelled"].includes(t.status))return false;
  if((snapshot.executions||[]).some((j:Row)=>j.taskId===t.id&&["preparing","dispatching","running","verifying","cancelling","unknown"].includes(j.status)))return false;
  if((snapshot.messages||[]).some((m:Row)=>m.taskId===t.id&&["recorded","dispatching","accepted","in_progress","queued_native","unknown"].includes(m.delivery)))return false;
  const seen=new Set([t.id]);let p=byId.get(t.parentTaskId);
  while(p&&!seen.has(p.id)){seen.add(p.id);if(["completed","cancelled"].includes(p.status))return true;p=byId.get(p.parentTaskId);}return false;
 });
 const ids=new Set(historical.map(t=>t.id));return {historical,current:tasks.filter(t=>!ids.has(t.id)&&!["completed","cancelled"].includes(t.status))};
}
