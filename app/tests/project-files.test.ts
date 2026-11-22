import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appRoot } from "../src/server/config.js";
import { readProjectFile } from "../src/server/project-files.js";
it("reads explicitly scoped UTF-8 text with a content fingerprint, never executes source", () => {
  const root = fs.mkdtempSync(path.join(appRoot, "runtime/project-read-"));
  fs.writeFileSync(path.join(root, "README.md"), "项目说明");
  fs.writeFileSync(
    path.join(root, "sample.ts"),
    "throw Error('must never execute')",
  );
  expect(readProjectFile(root, "README.md")).toMatchObject({
    content: "项目说明",
  });
  expect(readProjectFile(root, "sample.ts").sha256).toMatch(/^[a-f0-9]{64}$/);
  fs.mkdirSync(path.join(root, "Assets/Scripts/Runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "Assets/Scripts/Runtime/Model.cs"), "// source");
  expect(readProjectFile(root, "Assets/Scripts/Runtime/Model.cs").content).toBe("// source");
  fs.mkdirSync(path.join(root, "中文文档"));
  fs.writeFileSync(path.join(root, "中文文档", "设计 方案.md"), "已确认设计");
  expect(readProjectFile(root, "中文文档/设计 方案.md").content).toBe("已确认设计");
  for (const p of [
    "../README.md",
    "archive/old.md",
    "runtime/auth.json",
    ".git/config",
    "README.md:stream",
    "C:/Windows/win.ini",
    "README.md.",
    "NUL.txt",
    "设计\u202e.md",
  ])
    expect(() => readProjectFile(root, p)).toThrow();
  fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(70000));
  expect(() => readProjectFile(root, "big.txt")).toThrow();
  fs.writeFileSync(path.join(root, "bad.txt"), Buffer.from([255, 254]));
  expect(() => readProjectFile(root, "bad.txt")).toThrow();
});
