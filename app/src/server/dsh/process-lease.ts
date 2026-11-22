import { createRequire } from "node:module";
import type { DshInstallation } from "./sdk.js";

/** Process lifetime only: tools still run in the official DSH sandbox.
 * A non-inheritable kill-on-close Job prevents orphaned SDK/tool descendants
 * surviving a Studio crash. No token, filesystem or network grants here. */
export function processLease(installation: DshInstallation, name: string) {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw Error(
      "Managed Shell requires verified Windows x64 process containment",
    );
  const require = createRequire(installation.entry);
  const koffi = require("koffi");
  const dll = koffi.load("kernel32.dll");
  const create = dll.func("void * __stdcall CreateJobObjectW(void *, str16)");
  const open = dll.func("void * __stdcall OpenJobObjectW(uint32, bool, str16)");
  const set = dll.func(
    "bool __stdcall SetInformationJobObject(void *, int, void *, uint32)",
  );
  const query = dll.func(
    "bool __stdcall QueryInformationJobObject(void *, int, void *, uint32, void *)",
  );
  const assign = dll.func(
    "bool __stdcall AssignProcessToJobObject(void *, void *)",
  );
  const terminate = dll.func(
    "bool __stdcall TerminateJobObject(void *, uint32)",
  );
  const proc = dll.func("void * __stdcall OpenProcess(uint32, bool, uint32)");
  const close = dll.func("bool __stdcall CloseHandle(void *)");
  const error = dll.func("uint32 __stdcall GetLastError()");
  const fail = (op: string): never => {
    throw Error(`${op}: Win32 ${error()}`);
  };
  function active(h: any) {
    const b = Buffer.alloc(48);
    if (!query(h, 1, b, 48, null)) fail("Query Job accounting");
    return b.readUInt32LE(40);
  }
  return {
    async recover() {
      const h = open(0xc, false, name);
      if (!h) {
        if (error() === 2) return;
        fail("Open existing process lease");
      }
      try {
        if (active(h) !== 0)
          throw Error(
            "Existing SDK process lease is still active; do not reprovision or revoke",
          );
      } finally {
        close(h);
      }
    },
    create(pid: number) {
      const h = create(null, name);
      if (!h) fail("Create Job");
      if (error() === 183) {
        close(h);
        throw Error("Process lease name already exists");
      }
      try {
        const limits = Buffer.alloc(144);
        limits.writeUInt32LE(0x2000, 16);
        if (!set(h, 9, limits, 144)) fail("Set kill-on-close");
        const p = proc(0x101, false, pid);
        if (!p) fail("Open SDK process");
        try {
          if (!assign(h, p)) fail("Assign SDK process");
        } finally {
          close(p);
        }
      } catch (e) {
        close(h);
        throw e;
      }
      let disposed = false;
      return {
        async stop() {
          if (disposed) return;
          if (!terminate(h, 1)) fail("Terminate owned process lease");
          for (let i = 0; i < 100 && active(h) !== 0; i++)
            await new Promise((r) => setTimeout(r, 50));
          if (active(h) !== 0)
            throw Error(
              "Owned SDK descendants have not exited; keep recovery pending",
            );
          if (!close(h)) fail("Close process lease");
          disposed = true;
        },
      };
    },
  };
}
