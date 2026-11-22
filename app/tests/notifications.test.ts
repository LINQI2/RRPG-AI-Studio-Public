import {expect,test} from "vitest";
import {notificationItems} from "../src/web/notifications.js";
import {decisionAudience} from "../src/shared/decision-routing.js";
test("technical requests do not create producer unread notices; legacy requests are explicitly unclassified",()=>{
 expect(decisionAudience({})).toBe("unclassified");
 const items=notificationItems({decisions:[{id:"technical",audience:"technical",status:"open"},{id:"product",audience:"producer",status:"open",owner:"developer"},{id:"legacy",status:"open"},{id:"done",audience:"producer",status:"answered"}]});
 expect(items.map(n=>n.id)).toEqual(["decision:product","decision:legacy"]);
});
test("tool events, peer messages, commentary and incomplete acceptance do not masquerade as actionable notices",()=>{
 const s={messages:[{id:"comment",nativeItemId:"1",recipient:"producer",phase:"commentary"},{id:"peer",nativeItemId:"2",recipient:"planner",phase:"final_answer"},{id:"reply",nativeItemId:"3",recipient:"producer",sender:"developer",phase:"final_answer"}],tasks:[{id:"t",status:"awaiting_acceptance",acceptance:"producer"}],executions:[{status:"running"}]};
 expect(notificationItems(s).map(n=>n.id)).toEqual(["reply:reply"]);
});
