// Protocol fixture only. Never a substitute for real Codex integration.
import readline from "node:readline";
import fs from "node:fs";
const stateFile = process.env.FAKE_STATE;
let state = { threads: {}, count: 0 };
if (stateFile && fs.existsSync(stateFile))
  state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const save = () => {
  if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(state));
};
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const event = (method, params) => send({ method, params });
const timers = new Map();
function start(threadId, input, clientId) {
  const t = state.threads[threadId];
  const id = "turn-" + ++state.count;
  const text = input?.[0]?.text || "";
  const turn = {
    id,
    status: "inProgress",
    items: [
      { id: "user-" + id, type: "userMessage", clientId, content: input },
    ],
  };
  t.turns.push(turn);
  t.status = { type: "active" };
  save();
  event("turn/started", { threadId, turn });
  const complete = () => {
    if (turn.status !== "inProgress") return;
    turn.status = "completed";
    turn.items.push({
      id: "reply-" + id,
      type: "agentMessage",
      text: "FIXTURE ONLY: " + text,
      phase: "final_answer",
    });
    t.status = { type: "idle" };
    save();
    for (const item of turn.items)
      event("item/completed", { threadId, turnId: id, item });
    event("turn/completed", { threadId, turn });
  };
  if (text.includes("EARLY_FINAL")) complete();
  else timers.set(id, setTimeout(complete, text.includes("SLOW") ? 1200 : 80));
  return turn;
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (!m.method) return;
  const p = m.params || {};
  let result = {};
  try {
    switch (m.method) {
      case "initialize":
        result = { userAgent: "fixture" };
        break;
      case "initialized":
        return;
      case "account/read":
        result = { account: { type: "fixture" } };
        break;
      case "thread/start": {
        const id = "fixture-thread-" + ++state.count;
        state.threads[id] = {
          id,
          status: { type: "idle" },
          turns: [],
          queue: [],
          goal: null,
        };
        save();
        result = { thread: state.threads[id] };
        break;
      }
      case "thread/read":
      case "thread/resume": {
        const t = state.threads[p.threadId];
        if (!t) throw Error("Thread not found");
        result = { thread: t };
        break;
      }
      case "thread/turns/list":
        result = {
          data: state.threads[p.threadId].turns.slice().reverse(),
          nextCursor: null,
        };
        break;
      case "thread/goal/get":
        result = { goal: state.threads[p.threadId].goal };
        break;
      case "thread/goal/set": {
        const t = state.threads[p.threadId];
        t.goal = {
          ...t.goal,
          ...p,
          objective: p.objective || t.goal?.objective,
        };
        save();
        result = { goal: t.goal };
        break;
      }
      case "thread/goal/clear":
        state.threads[p.threadId].goal = null;
        save();
        break;
      case "thread/queue/add": {
        const q = {
          id: "q-" + ++state.count,
          clientUserMessageId: p.clientUserMessageId,
          input: p.input,
        };
        state.threads[p.threadId].queue.push(q);
        save();
        result = { queuedSubmission: q };
        break;
      }
      case "thread/queue/list":
        result = { data: state.threads[p.threadId].queue, nextCursor: null };
        break;
      case "thread/queue/start": {
        const t = state.threads[p.threadId];
        const q = t.queue.find((q) => q.id === p.queuedSubmissionId);
        t.queue = t.queue.filter((x) => x !== q);
        result = { turn: start(p.threadId, q.input, q.clientUserMessageId) };
        break;
      }
      case "turn/start":
        result = { turn: start(p.threadId, p.input, p.clientUserMessageId) };
        break;
      case "turn/steer": {
        const t = state.threads[p.threadId].turns.at(-1);
        if (t?.status !== "inProgress" || t.id !== p.expectedTurnId)
          throw Error("Expected Turn mismatch");
        result = { turnId: t.id };
        break;
      }
      case "turn/interrupt": {
        const t = state.threads[p.threadId],
          turn = t.turns.at(-1);
        if (turn?.id !== p.turnId || turn.status !== "inProgress")
          throw Error("No active Turn");
        clearTimeout(timers.get(turn.id));
        turn.status = "interrupted";
        t.status = { type: "idle" };
        save();
        event("turn/completed", { threadId: p.threadId, turn });
        break;
      }
      case "fixture/timeout":
        return;
      case "fixture/serverRequest":
        send({
          id: 9001,
          method: "item/permissions/requestApproval",
          params: { threadId: p.threadId, permissions: {} },
        });
        break;
      case "fixture/invalid":
        process.stdout.write("not json\n");
        break;
      case "fixture/split": {
        const bytes = Buffer.from(
          JSON.stringify({
            method: "fixture/unicode",
            params: { text: "中文分片" },
          }) + "\n",
        );
        process.stdout.write(bytes.subarray(0, bytes.length - 8));
        setTimeout(() => {
          process.stdout.write(bytes.subarray(bytes.length - 8));
          send({ id: m.id, result: {} });
        }, 2);
        return;
      }
      default:
        throw Error("Unsupported method " + m.method);
    }
    if (m.id !== undefined) send({ id: m.id, result });
  } catch (e) {
    send({ id: m.id, error: { code: -32602, message: String(e) } });
  }
});
