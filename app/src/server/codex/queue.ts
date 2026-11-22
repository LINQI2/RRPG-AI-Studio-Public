import { Transport } from "./transport.js";
// Native queue ownership is separate from the Studio outbox. Do not enable both.
export class NativeQueue {
  constructor(public rpc: Transport) {}
  add(threadId: string, messageId: string, text: string) {
    return this.rpc.call("thread/queue/add", {
      threadId,
      clientUserMessageId: messageId,
      input: [{ type: "text", text }],
    });
  }
  async list(threadId: string) {
    const data: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.rpc.call("thread/queue/list", {
        threadId,
        ...(cursor ? { cursor } : {}),
        limit: 50,
      });
      data.push(...r.data);
      cursor = r.nextCursor || undefined;
    } while (cursor);
    return data;
  }
  update(threadId: string, id: string, text: string) {
    return this.rpc.call("thread/queue/update", {
      threadId,
      queuedSubmissionId: id,
      input: [{ type: "text", text }],
    });
  }
  remove(threadId: string, id: string) {
    return this.rpc.call("thread/queue/delete", {
      threadId,
      queuedSubmissionId: id,
    });
  }
  start(threadId: string, id: string) {
    return this.rpc.call("thread/queue/start", {
      threadId,
      queuedSubmissionId: id,
    });
  }
}
