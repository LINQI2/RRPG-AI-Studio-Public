import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { appRoot } from "../src/server/config.js";
import { inspectProject } from "../src/server/project-inspect.js";

it("fixed readonly baseline hashes Unicode dirty files and excludes secrets without staging", () => {
  const root = fs.mkdtempSync(path.join(appRoot, "runtime/tests/inspect-"));
  expect(spawnSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true }).status).toBe(0);
  fs.writeFileSync(path.join(root, "设计 文档.md"), "确认内容");
  fs.writeFileSync(path.join(root, ".env"), "PRIVATE_DUMMY_NOT_FOR_OUTPUT=abc");
  fs.mkdirSync(path.join(root, "Assets/Scripts/Runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "Assets/Scripts/Runtime/Model.cs"), "// source");
  const first = inspectProject(root);
  expect(first.files.find(f => f.path === "Assets/Scripts/Runtime/Model.cs")).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(first.files.find(f => f.path === "设计 文档.md")).toMatchObject({ status: "??", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(first.files.find(f => f.path === ".env")).toMatchObject({ excluded: expect.any(String) });
  expect(JSON.stringify(first)).not.toContain("PRIVATE_DUMMY");
  expect(first.complete).toBe(false);
  expect(fs.existsSync(path.join(root, ".git/index"))).toBe(false);
  expect(inspectProject(root).files).toEqual(first.files);
});

it("does not silently inspect the parent repository when given a subdirectory", () => {
  const root = fs.mkdtempSync(path.join(appRoot, "runtime/tests/inspect-"));
  expect(spawnSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true }).status).toBe(0);
  fs.mkdirSync(path.join(root, "sub"));
  expect(() => inspectProject(path.join(root, "sub"))).toThrow("仓库根");
});
