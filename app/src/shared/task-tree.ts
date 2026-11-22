type Row = Record<string, any>;
export function validateTaskParent(tasks: Row[], id: string, parent: string | null) {
  if (parent === null) return;
  const byId = new Map(tasks.map(t => [t.id, t]));
  if (typeof parent !== "string" || !byId.has(parent)) throw Error("父任务不存在");
  const seen = new Set([id]);
  let current: string | null = parent;
  while (current) {
    if (seen.has(current)) throw Error("不能把任务放到自身或其子任务下，任务树不能成环");
    seen.add(current);
    const task = byId.get(current);
    if (!task) throw Error("上级任务关系不完整，请先核对");
    current = task.parentTaskId || null;
  }
}
export function taskForest(tasks: Row[], matched: string[], limit: number) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const parent = new Map<string, string | null>();
  for (const t of tasks) {
    try { validateTaskParent(tasks, t.id, t.parentTaskId || null); parent.set(t.id, t.parentTaskId || null); }
    catch { parent.set(t.id, null); }
  }
  const visible = new Set(matched.slice(0, limit));
  for (const id of [...visible]) { let p=parent.get(id); while(p){visible.add(p); p=parent.get(p);} }
  const children = new Map<string | null, Row[]>();
  for (const t of tasks) {
    const p=parent.get(t.id)||null;
    children.set(p,[...(children.get(p)||[]),t]);
  }
  const descendants = (id: string): Row[] => (children.get(id)||[]).flatMap(t=>[t,...descendants(t.id)]);
  return { roots:(children.get(null)||[]).filter(t=>visible.has(t.id)), children, descendants, visible, byId, parent };
}
