import { defineConfig } from "@playwright/test";
const runEvidence = `runtime/browser-history/${Date.now()}-${process.pid}`;
export default defineConfig({
  outputDir: `${runEvidence}/traces`,
  globalTeardown: "./tests/browser/teardown.ts",
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3199",
    channel: "msedge",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/test-server.ts",
    url: "http://127.0.0.1:3199",
    reuseExistingServer: false,
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "runtime/browser-results.json" }],
    ["json", { outputFile: `${runEvidence}/results.json` }],
  ],
});
