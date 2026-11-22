import fs from "node:fs";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { safePath, appRoot } from "../config.js";
import type { Row } from "../../shared/contracts.js";

// Read-only recovery of official v4 concatenated zstd frames. No SDK prompt,
// no private transcript in the public response, no guess based on file presence.
export function readSessionJournal(job: Row): Row[] {
  if (!/^rrpg-dsh-[a-z0-9-]+$/.test(job.sessionId)) throw Error("无效Session标识");
  const root = safePath(appRoot, path.join(job.home, "sessions"));
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.isSymbolicLink())
    .map(e => safePath(root, path.join(root, e.name, job.sessionId, "session.v4.jsonl.zstd")))
    .filter(file => fs.existsSync(file));
  if (candidates.length !== 1) throw Error("原生会话记录缺失或存在歧义");
  const file = candidates[0]!;
  if (fs.statSync(file).size > 20_000_000) throw Error("原生记录超出恢复预算");
  const bytes = fs.readFileSync(file); let offset = 0, total = 0;
  const buffers: Buffer[] = [];
  while (offset < bytes.length) {
    const frame = zstdDecompressSync(bytes.subarray(offset), { info: true, maxOutputLength: 20_000_000 }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (!frame.engine.bytesWritten) throw Error("原生压缩帧损坏");
    offset += frame.engine.bytesWritten; total += frame.buffer.length;
    if (total > 50_000_000) throw Error("原生记录解压超出预算");
    buffers.push(frame.buffer);
  }
  const rows = Buffer.concat(buffers).toString("utf8").trim().split("\n").map(s => JSON.parse(s));
  const header = rows[0];
  if (header?.type !== "session" || header.version !== 4 || header.id !== job.sessionId ||
      path.resolve(header.cwd).toLowerCase() !== path.resolve(job.workspace).toLowerCase())
    throw Error("原生会话身份、版本或工程不符");
  const events = rows.slice(1).filter(r => Number.isSafeInteger(r.seq));
  if (events.some((r, i) => i > 0 && r.seq <= events[i - 1].seq)) throw Error("原生事件序号不唯一有序");
  return events;
}
