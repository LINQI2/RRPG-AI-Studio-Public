import Fastify from "fastify";
import cookie from "@fastify/cookie";
import statics from "@fastify/static";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { Studio } from "./studio.js";
import { Bridge } from "./bridge.js";
import { appRoot, studioRoot, safePath } from "./config.js";
import { contractSchema, deliverySchema } from "../shared/product.js";
import { executionOptionFields } from "./dsh/policy.js";
import { readProjectFile } from "./project-files.js";
import { UnityConnection } from "./unity/connection.js";
import { maintenance, buildFingerprint } from "./runtime-status.js";
import {rulesView,saveSupplement} from './rules.js';
const role = z.enum(["planner", "developer"]);
const message = z
  .object({
    recipient: role,
    content: z.string().min(1).max(40000),
    kind: z.enum(["request", "reply", "notification"]).optional(),
    replyTo: z.string().optional(),
    taskId: z.string().optional(),
    clientRequestId: z.string().min(8).max(160),
    bindingRevision: z.number().int().optional(),
  })
  .strict();
export async function webServer(studio: Studio) {
  const app = Fastify({ bodyLimit: 250000, logger: false });
  await app.register(cookie);
  const sessions = new Map<string, string>();
  const bridge = new Bridge(studio);
  const streams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
    streams.clear();
  });
  app.setErrorHandler((e: any, _req, res) =>
    res
      .code(e.statusCode || (e instanceof z.ZodError ? 400 : 500))
      .send({ error: e.message }),
  );
  app.addHook("onRequest", async (req, res) => {
    const hostname = req.headers.host?.split(":")[0];
    if (!["127.0.0.1", "localhost"].includes(hostname || ""))
      return res.code(403).send({ error: "Invalid Host" });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    )
      return res.code(403).send({ error: "Cross-origin request rejected" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.code(403).send({ error: "Cross-site request rejected" });
    res.header("Cache-Control", "no-store");
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Referrer-Policy", "no-referrer");
    if (!req.url.startsWith("/api/")) {
      res.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
      );
      return;
    }
    if (req.url === "/api/session" && req.method === "GET") return;
    const csrf = sessions.get(req.cookies.studio || "");
    if (!csrf)
      return res
        .code(401)
        .send({ error: "Open the Studio page to establish local session" });
    if (!["GET", "HEAD"].includes(req.method)) {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return res.code(415).send({ error: "JSON required" });
      if (req.headers["x-studio-csrf"] !== csrf)
        return res.code(403).send({ error: "CSRF token invalid" });
    }
  });
  app.get("/api/session", async (req, res) => {
    let sid = req.cookies.studio;
    let csrf = sid ? sessions.get(sid) : undefined;
    if (!csrf) {
      sid = randomBytes(32).toString("hex");
      csrf = randomBytes(32).toString("hex");
      sessions.set(sid, csrf);
      res.setCookie("studio", sid, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      });
    }
    return { csrf };
  });
  app.get("/api/snapshot", () => studio.snapshot());
  app.get('/api/rules',()=>rulesView(studio.store,studio.cfg));
  app.put('/api/rules/:role',(req)=>{
    const {role:id}=z.object({role:z.enum(['planner','developer'])}).parse(req.params);
    const {content,expectedRevision}=z.object({content:z.string().max(8000),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
    return saveSupplement(studio.store,studio.cfg,id,content,expectedRevision);
  });
  app.get("/api/runtime-status", () => ({ running: studio.buildInfo, diskFingerprint: buildFingerprint(), maintenance: maintenance(studio.cfg) }));
  app.post("/api/tasks/:id/executions", (req, res) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = z
      .object({
        instruction: z.string().trim().min(1).max(20000),
        clientRequestId: z.string().min(8).max(160),
        shellMode: z.literal("managed").optional(),
        ...executionOptionFields,
      })
      .strict()
      .parse(req.body);
    return res.code(202).send(studio.dsh.request(id, input));
  });
  app.get("/api/executions/:id/events", (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return studio.store
      .all("execution_events")
      .filter((e) => e.executionId === id);
  });
  app.post("/api/executions/:id/reconcile", (req) =>
    studio.dsh.reconcile(z.object({ id: z.string() }).parse(req.params).id),
  );
  app.post("/api/executions/:id/review", (req) =>
    studio.dsh.reviewUnknown(z.object({ id: z.string() }).parse(req.params).id),
  );
  app.post("/api/executions/:id/verify-recovery", (req) => {
    const { clientRequestId } = z.object({ clientRequestId: z.string().min(8).max(160) }).strict().parse(req.body);
    return studio.dsh.verifyRecovery(z.object({ id: z.string() }).parse(req.params).id, clientRequestId);
  });
  app.post("/api/executions/:id/resume", (req) =>
    studio.dsh.recover(z.object({ id: z.string() }).parse(req.params).id),
  );
  app.post("/api/executions/:id/stop", (req) => {
    const { kind } = z
      .object({ kind: z.enum(["cancel", "interrupt"]) })
      .strict()
      .parse(req.body);
    return studio.dsh.cancel(
      z.object({ id: z.string() }).parse(req.params).id,
      kind,
    );
  });
  app.get("/api/artifact", (req) => {
    const value = z.object({ path: z.string() }).parse(req.query).path;
    if (value.startsWith("dsh-result/")) {
      const [, id, ...segments] = value.split("/");
      return studio.readDshResult(id, segments.join("/"), "producer");
    }
    return readProjectFile(studio.cfg.project,value);
  });
  app.get("/api/progress", (req) => {
    const q = z
      .object({ after: z.coerce.number().int().nonnegative().default(0) })
      .parse(req.query);
    const rows = studio.store.db
      .prepare(
        "SELECT * FROM events WHERE seq>? AND type IN ('tasks.created','tasks.updated','decisions.created','decisions.updated') ORDER BY seq LIMIT 101",
      )
      .all(q.after) as any[];
    return {
      rows: rows.slice(0, 100).map((r) => ({ ...r, data: JSON.parse(r.data) })),
      next: rows.length > 100 ? rows[99].seq : null,
      coveredThrough: rows.length > 100 ? rows[99].seq : studio.store.cursor(),
    };
  });
  app.post("/api/project-goal", (req) => {
    const b = z
      .object({
        objective: z.string().trim().min(1).max(8000),
        next: z.string().max(8000),
      })
      .strict()
      .parse(req.body);
    return studio.store.get("settings", "projectGoal")
      ? studio.store.update("settings", "projectGoal", b)
      : studio.store.create("settings", { id: "projectGoal", ...b });
  });
  app.get("/api/diagnostics", () => ({
    connected: studio.connected,
    authenticated: Boolean(studio.account),
    lastError: studio.lastError,
    capabilities: studio.diagnostics,
  }));
  app.post("/api/connect", async () => {
    if (studio.connected) {
      const r = await studio.rpc.call("account/read", { refreshToken: true });
      studio.account = r.account;
      await studio.inspectExecution();
      for (const a of studio.store.all("agents")) void studio.pump(a.id);
      return { connected: true, authenticated: Boolean(r.account) };
    }
    return studio.connect();
  });
  app.post("/api/initialize", () => studio.initialize());
  app.post("/api/messages", async (req, res) => {
    const b = message.parse(req.body);
    const r = studio.submit(b, "producer", `producer:${b.clientRequestId}`);
    return res.code(202).send(r);
  });
  app.post("/api/messages/:id/cancel", (req) =>
    studio.cancelMessage(z.object({ id: z.string() }).parse(req.params).id),
  );
  app.get("/api/agents/:role/history", (req) => {
    const p = z.object({ role }).parse(req.params);
    const q = z.object({ cursor: z.string().optional() }).parse(req.query);
    return studio.history(p.role, q.cursor);
  });
  app.post("/api/agents/:role/binding", (req) => {
    const p = z.object({ role }).parse(req.params);
    const b = z
      .object({ threadId: z.string().min(1), revision: z.number().int() })
      .strict()
      .parse(req.body);
    return studio.bind(p.role, b.threadId, b.revision);
  });
  app.post("/api/agents/:role/reconcile", (req) =>
    studio.reconcile(z.object({ role }).parse(req.params).role),
  );
  app.post("/api/agents/:role/recreate-missing", (req) =>
    studio.recreateMissing(z.object({ role }).parse(req.params).role),
  );
  app.post("/api/agents/:role/steer", (req) =>
    studio.control(
      z.object({ role }).parse(req.params).role,
      "steer",
      z
        .object({ turnId: z.string(), content: z.string().min(1).max(40000) })
        .strict()
        .parse(req.body),
    ),
  );
  app.post("/api/agents/:role/interrupt", (req) =>
    studio.control(
      z.object({ role }).parse(req.params).role,
      "interrupt",
      z.object({ turnId: z.string() }).strict().parse(req.body),
    ),
  );
  app.post("/api/agents/:role/goal", (req) =>
    studio.control(
      z.object({ role }).parse(req.params).role,
      "goal",
      z
        .object({
          action: z.enum(["active", "paused", "clear"]),
          objective: z.string().min(1).max(5000).optional(),
          tokenBudget: z.number().int().positive().optional(),
        })
        .strict()
        .parse(req.body),
    ),
  );
  app.post("/api/tasks", (req) =>
    studio.createTask(
      z
        .object({
          title: z.string().min(1).max(200),
          objective: z.string().min(1).max(20000),
          parentTaskId: z.string().min(1).nullable().optional(),
          owner: role,
          executor: z.enum(["codex", "dsh"]).optional(),
          useUnity: z.boolean().optional(),
          acceptance: z.enum(["producer", "autonomous"]),
          purpose: z.enum(["product", "unknown"]).optional(),
          contract: contractSchema.optional(),
        })
        .strict()
        .parse(req.body),
    ),
  );
  app.post("/api/tasks/:id/parent", (req) => {
    const b=z.object({parentTaskId:z.string().min(1).nullable(),reason:z.string().trim().min(1).max(4000),expectedUpdatedAt:z.string()}).strict().parse(req.body);
    return studio.setTaskParent(z.object({id:z.string()}).parse(req.params).id,b.parentTaskId,b.reason,b.expectedUpdatedAt);
  });
  app.patch("/api/tasks/:id", (req) =>
    studio.updateTask(
      z.object({ id: z.string() }).parse(req.params).id,
      z
        .object({
          status: z.string().optional(),
          summary: z.string().optional(),
          evidence: z.array(z.string()).optional(),
          delivery: deliverySchema.optional(),
          correctionReason: z.string().trim().min(1).max(4000).optional(),
          expectedUpdatedAt: z.string().optional(),
        })
        .strict()
        .parse(req.body),
    ),
  );
  app.post("/api/tasks/:id/acceptance", (req) => {
    const b = z
      .object({
        action: z.enum(["approve", "revise", "discuss"]),
        comment: z.string(),
      })
      .strict()
      .parse(req.body);
    return studio.acceptTask(
      z.object({ id: z.string() }).parse(req.params).id,
      b.action,
      b.comment,
    );
  });
  app.post("/api/tasks/:id/actions", (req) =>
    studio.taskAction(
      z.object({ id: z.string() }).parse(req.params).id,
      z
        .object({
          action: z.enum([
            "start",
            "continue",
            "resend",
            "approve",
            "revise",
            "discuss",
          ]),
          comment: z.string().trim().min(1).max(20000),
          clientRequestId: z.string().min(8).max(160),
          expectedUpdatedAt: z.string(),
          expectedStatus: z.string(),
          bindingRevision: z.number().int(),
          expectedDeliveryId: z.string().nullable().optional(),
        })
        .strict()
        .parse(req.body),
    ),
  );
  app.post("/api/decisions/:id/route",(req)=>{
    const b=z.object({audience:z.enum(["producer","technical"]),reason:z.string().trim().min(1).max(4000),expectedUpdatedAt:z.string()}).strict().parse(req.body);
    return studio.routeDecision(z.object({id:z.string()}).parse(req.params).id,b.audience,b.reason,b.expectedUpdatedAt);
  });
  app.post("/api/decisions/:id/answer", (req) =>
    studio.decide(
      z.object({ id: z.string() }).parse(req.params).id,
      z
        .object({ answer: z.string().min(1).max(20000) })
        .strict()
        .parse(req.body).answer,
    ),
  );
  app.post("/api/requests/:id/answer", (req) =>
    studio.answerRequest(
      z.object({ id: z.string() }).parse(req.params).id,
      z
        .object({
          answers: z.record(
            z.string(),
            z.object({ answers: z.array(z.string()) }),
          ),
        })
        .strict()
        .parse(req.body).answers,
    ),
  );
  app.post("/api/view-cursor", (req) => {
    const b = z
      .object({ seq: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    studio.store.atomic(() =>
      studio.store.put("settings", {
        id: "viewCursor",
        seq: Math.min(b.seq, studio.store.cursor()),
      }),
    );
    return { ok: true };
  });
  app.post("/api/unity/check",async()=>{const {identity}=await new UnityConnection(studio.cfg).inspect();return identity;});
  app.post("/api/handoffs/scan", () => bridge.scan());
  app.post("/api/handoffs/:id/notify", (req) =>
    bridge.notify(z.object({ id: z.string() }).parse(req.params).id),
  );
  app.post("/api/handoffs/:id/review", (req) =>
    bridge.record(
      z.object({ id: z.string() }).parse(req.params).id,
      z
        .object({
          summary: z.string().min(1),
          evidence: z.array(z.string().min(1)).min(1),
        })
        .strict()
        .parse(req.body),
    ),
  );
  app.post("/api/backup", async () => {
    const dir = safePath(appRoot, path.join(studio.cfg.runtime, "backups"));
    fs.mkdirSync(dir, { recursive: true });
    return {
      path: await studio.store.backup(
        path.join(dir, `studio-${Date.now()}.sqlite`),
      ),
    };
  });
  app.post("/api/shutdown", async (_req, res) => {
    if (!studio.onShutdown)
      return res
        .code(409)
        .send({ error: "Shutdown is not available in this test host" });
    setTimeout(() => void studio.onShutdown?.(), 100);
    return { status: "stopping" };
  });
  app.get("/api/events", (req, res) => {
    const after = Number(
      (req.query as any).after || req.headers["last-event-id"] || 0,
    );
    if (!Number.isSafeInteger(after) || after < 0)
      return res.code(400).send({ error: "Invalid cursor" });
    res.hijack();
    streams.add(res.raw);
    res.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.raw.flushHeaders();
    let cursor = after;
    let closed = false;
    const write = (text: string) => {
      if (res.raw.writableLength > 1024 * 1024) {
        cleanup();
        res.raw.end();
        return false;
      }
      return res.raw.write(text);
    };
    const flush = () => {
      if (closed) return;
      let rows;
      do {
        rows = studio.store.events(cursor);
        for (const event of rows) {
          write(
            `id: ${event.seq}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`,
          );
          cursor = event.seq;
        }
      } while (rows.length === 500 && !closed);
    };
    const delta = (m: any) =>
      write(`event: delta\ndata: ${JSON.stringify(m)}\n\n`);
    const heartbeat = setInterval(() => write(": heartbeat\n\n"), 15000);
    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      streams.delete(res.raw);
      studio.store.off("changed", flush);
      studio.store.off("delta", delta);
    }
    studio.store.on("changed", flush);
    studio.store.on("delta", delta);
    res.raw.on("close", cleanup);
    flush();
    return res;
  });
  const web = path.join(appRoot, "dist/web");
  if (fs.existsSync(web))
    await app.register(statics, {
      root: web,
      prefix: "/",
      index: "index.html",
    });
  return app;
}
