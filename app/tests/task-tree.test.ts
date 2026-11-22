import {expect,test} from "vitest";
import {validateTaskParent,taskForest} from "../src/shared/task-tree.js";
const tasks=[{id:"p"},{id:"a",parentTaskId:"p"},{id:"b",parentTaskId:"p"},{id:"c",parentTaskId:"a"}];
test("explicit parent links preserve siblings and levels",()=>{
 const f=taskForest(tasks,tasks.map(t=>t.id),30);
 expect(f.roots.map(t=>t.id)).toEqual(["p"]);
 expect(f.children.get("p")?.map(t=>t.id)).toEqual(["a","b"]);
 expect(f.descendants("p").map(t=>t.id)).toEqual(["a","c","b"]);
});
test("self, missing parent and circular reparenting are rejected",()=>{
 for(const [id,parent] of [["p","p"],["p","c"],["a","missing"]])expect(()=>validateTaskParent(tasks,id,parent)).toThrow();
 expect(()=>validateTaskParent(tasks,"a",null)).not.toThrow();
});
test("filter retains ancestors, limit retains context, matching titles do not infer a link",()=>{
 const f=taskForest([...tasks,{id:"same-title",title:"p"}],["c"],1);
 expect([...f.visible]).toEqual(["c","a","p"]);
 expect(f.roots.map(t=>t.id)).toEqual(["p"]);
 expect(f.children.get(null)?.map(t=>t.id)).toContain("same-title");
});
test("corrupt history remains readable without recursive loops or silent deletion",()=>{
 const f=taskForest([{id:"a",parentTaskId:"b"},{id:"b",parentTaskId:"a"},{id:"c",parentTaskId:"missing"}],["a","b","c"],30);
 expect(f.roots).toHaveLength(3);
 expect(f.descendants("a")).toEqual([]);
});
