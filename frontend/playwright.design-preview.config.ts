import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const port = Number(process.env.DESIGN_PREVIEW_PORT || 5186);
const output =
  process.env.DESIGN_PREVIEW_RESULTS || "/tmp/temple-inventory-design-browser";
export default defineConfig({
  testDir: "tests/browser/design-preview",
  outputDir: `${output}/artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${output}/results.json` }],
    [
      "html",
      {
        outputFolder: `${output}/report`,
        open: "never",
      },
    ],
  ],
  workers: 2,
  fullyParallel: true,
  timeout: 90000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 10000,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
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
  webServer: {
    command: `pnpm exec vite --config vite.preview-design.config.ts --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/design-preview.html`,
    reuseExistingServer: false,
  },
});
