import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    fsModuleCache: true,
    // Keep DOM-heavy editor suites within the development container's CPU budget.
    maxWorkers: 4,
    include: ["tests/**/*.test.ts"],
  },
});
