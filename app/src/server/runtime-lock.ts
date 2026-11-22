import fs from "node:fs";
import path from "node:path";
export function acquireRuntimeLock(runtime: string) {
  const file = path.join(runtime, "server.lock");
  if (fs.existsSync(file)) {
    const prior = JSON.parse(fs.readFileSync(file, "utf8"));
    let active = true;
    try {
      process.kill(prior.pid, 0);
    } catch (e: any) {
      if (e.code === "ESRCH") active = false;
    }
    if (active)
      throw Error(
        `Another Studio process may own this runtime (PID ${prior.pid})`,
      );
    fs.unlinkSync(file);
  }
  const fd = fs.openSync(file, "wx");
  fs.writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
  );
  fs.closeSync(fd);
  return () => {
    if (fs.existsSync(file)) {
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      if (current.pid === process.pid) fs.unlinkSync(file);
    }
  };
}
