import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const output =
  process.env.NATIVE_RESULTS ||
  "/tmp/temple-inventory-migration/native-browser";
export default defineConfig({
  testDir: "tests/browser/native-server",
  outputDir: `${output}/artifacts`,
  reporter: [["list"], ["json", { outputFile: `${output}/results.json` }]],
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  use: {
    baseURL: process.env.NATIVE_BASE_URL || "http://127.0.0.1:8101",
    viewport: { width: 1440, height: 1000 },
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium-headless-shell")
          ? "/usr/bin/chromium-headless-shell"
          : undefined),
      args: ["--no-sandbox"],
    },
  },
});
