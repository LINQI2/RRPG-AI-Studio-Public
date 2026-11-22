import {expect,test} from "vitest";
import {orderedExecutions} from "../src/web/execution-history.js";
test("execution history orders by creation/start rather than latest metadata update and does not mutate source",()=>{
 const rows=[{id:"new",createdAt:"2026-10-24T02:00:00Z"},{id:"old",createdAt:"2026-10-23T02:00:00Z",updatedAt:"2027-01-01T00:00:00Z"},{id:"middle",startedAt:"2026-10-24T01:00:00Z"}];
 expect(orderedExecutions(rows).map(r=>r.id)).toEqual(["old","middle","new"]);
 expect(rows[0].id).toBe("new");
});
test("missing native times stay deterministic without inventing a timestamp",()=>{
 expect(orderedExecutions([{id:"a"},{id:"b"}]).map(r=>r.id)).toEqual(["a","b"]);
});
