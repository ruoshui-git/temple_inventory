import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 120_000,
  reporter: "line",
  use: {
    serviceWorkers: "block",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
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
