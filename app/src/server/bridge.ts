import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Studio } from "./studio.js";
import { safePath, appRoot } from "./config.js";
import { StudioError } from "../shared/contracts.js";
const handoff = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(100000),
    producerConfirmed: z.literal(true),
    provenance: z.string().min(1).max(500),
  })
  .strict();
export class Bridge {
  constructor(public studio: Studio) {}
  scan() {
    const { cfg, store } = this.studio;
    let imported = 0;
    const errors: any[] = [];
    for (const name of fs
      .readdirSync(cfg.inbox)
      .filter((n) => n.endsWith(".json"))) {
      try {
        const target = safePath(cfg.inbox, path.join(cfg.inbox, name));
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200000)
          throw Error("Unsafe or oversized handoff");
        const bytes = fs.readFileSync(target);
        const doc = handoff.parse(JSON.parse(bytes.toString("utf8")));
        const fingerprint = createHash("sha256").update(bytes).digest("hex");
        const old = store.get("handoffs", doc.id);
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new StudioError(
              "Handoff ID reused with changed content",
              409,
            );
          continue;
        }
        store.create("handoffs", {
          ...doc,
          fingerprint,
          path: target,
          status: "discovered",
          authority: "candidate handoff, not GameSpec",
          project: cfg.project,
        });
        imported++;
      } catch (e) {
        errors.push({ file: name, error: String(e) });
      }
    }
    return { imported, errors };
  }
  notify(id: string) {
    const h = this.studio.store.get("handoffs", id);
    if (!h) throw new StudioError("Handoff not found", 404);
    if (h.status !== "discovered") return h;
    const task = this.studio.createTask(
      {
        title: `交接审查：${h.title}`,
        objective: `专业审查 设计交接 ${h.id}，核对规则一致性、整合影响并知会主开发；候选交接不自动成为正式 GameSpec。需要重要产品取舍时另行提供事实、选项和影响。`,
        owner: "planner",
        acceptance: "autonomous",
        purpose: "lab",
      },
      "producer",
      `handoff-task:${id}`,
    );
    const msg = this.studio.submit(
      {
        recipient: "planner",
        content: `请专业审查已登记的 设计交接，按既有授权自主完成，必要时与主开发协作。来源：${h.provenance}。不得把候选方案自动升级为正式 GameSpec。\n${h.content}`,
        taskId: task.id,
      },
      "producer",
      `handoff:${id}`,
    );
    return this.studio.store.update("handoffs", id, {
      status: "notified",
      taskId: task.id,
      messageId: msg.id,
    });
  }
  record(id: string, input: { summary: string; evidence: string[] }) {
    const h = this.studio.store.get("handoffs", id);
    if (!h || h.status !== "notified")
      throw new StudioError("Handoff is not ready", 409);
    if (!input.summary.trim() || !input.evidence.length)
      throw new StudioError("Summary and evidence required");
    const msg = this.studio.submit(
      {
        recipient: "developer",
        content: `设计交接已追加手工审查记录（不代表系统独立复验或权限扩大）。\n结论：${input.summary}\n证据引用：${input.evidence.join("\n")}`,
        taskId: h.taskId,
      },
      "producer",
      `handoff-developer:${id}`,
    );
    return this.studio.store.update("handoffs", id, {
      status: "review_recorded",
      summary: input.summary,
      evidence: input.evidence,
      developerMessageId: msg.id,
    });
  }
}
