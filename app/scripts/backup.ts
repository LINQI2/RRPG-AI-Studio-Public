import path from "node:path";
import fs from "node:fs";
import { Store } from "../src/server/db.js";
import { configuration } from "../src/server/config.js";
const cfg = configuration();
const dir = path.join(cfg.runtime, "backups");
fs.mkdirSync(dir, { recursive: true });
const store = new Store(path.join(cfg.runtime, "studio.sqlite"));
try {
  const target = path.join(dir, `studio-${Date.now()}.sqlite`);
  await store.backup(target);
  console.log(target);
} finally {
  store.close();
}
