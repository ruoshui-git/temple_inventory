import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const port = Number(process.env.NATIVE_UI_PORT || 8080);
export default defineConfig({
  testDir: "tests/browser",
  testIgnore: ["**/native-server/**"],
  outputDir: process.env.NATIVE_UI_RESULTS || "/tmp/temple-inventory-native-ui",
  workers: 1,
  timeout: 45000,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium-headless-shell")
          ? "/usr/bin/chromium-headless-shell"
          : undefined),
      args: [
        "--no-sandbox",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        ...(process.env.SCAN_VIDEO
          ? [`--use-file-for-fake-video-capture=${process.env.SCAN_VIDEO}`]
          : []),
      ],
    },
    permissions: ["camera"],
  },
  webServer: {
    command: `TI_DEV_PORT=${port} pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
