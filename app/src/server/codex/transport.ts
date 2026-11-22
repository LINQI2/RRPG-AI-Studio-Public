import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
export class RpcError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}
export class Transport extends EventEmitter {
  child?: ChildProcessWithoutNullStreams;
  seq = 0;
  ready = false;
  stopping = false;
  pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    public exe: string,
    public args: string[],
    public cwd: string,
    public env: NodeJS.ProcessEnv = process.env,
    public timeout = 25000,
  ) {
    super();
  }
  async start() {
    if (this.child) throw Error("Transport already running");
    this.stopping = false;
    const child = spawn(this.exe, this.args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    child.stdout.on("data", (b) => {
      buffer += decoder.write(b);
      if (buffer.length > 16 * 1024 * 1024) {
        this.lost(Error("Protocol frame exceeds limit"));
        child.kill();
        return;
      }
      let pos;
      while ((pos = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line));
        } catch (e) {
          this.emit("diagnostic", {
            message: "Invalid protocol frame",
            error: String(e),
          });
        }
      }
    });
    child.stderr.on("data", (b) =>
      this.emit("diagnostic", { message: b.toString().slice(0, 2000) }),
    );
    child.on("error", (e) => this.lost(e));
    child.on("exit", (code, signal) => {
      this.child = undefined;
      this.lost(Error(`App Server exited: ${code}/${signal}`));
    });
    child.stdin.on("error", (e) => this.lost(e));
    const result = await this.call("initialize", {
      clientInfo: {
        name: "rrpg_ai_studio",
        title: "RRPG AI Studio",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
    this.ready = true;
    return result;
  }
  receive(m: any) {
    if (m.method && m.id !== undefined) {
      this.emit("request", m);
      return;
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      m.error
        ? p.reject(new RpcError(m.error.message, m.error.code))
        : p.resolve(m.result);
      return;
    }
    if (m.method) this.emit("notification", m);
  }
  send(value: any) {
    if (!this.child || !this.child.stdin.writable)
      throw Error("App Server disconnected");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  call(method: string, params: any = {}, timeout = this.timeout): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`RPC timeout; outcome unknown: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  respond(id: number | string, result: any) {
    this.send({ id, result });
  }
  reject(id: number | string, message: string) {
    this.send({ id, error: { code: -32601, message } });
  }
  lost(error: Error) {
    this.ready = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    if (!this.stopping) this.emit("lost", error);
  }
  async stop() {
    this.lost(
      Error("App Server shutdown; in-flight outcome requires reconciliation"),
    );
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
      child.kill();
    });
  }
}
