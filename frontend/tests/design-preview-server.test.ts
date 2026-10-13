// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

let server: ViteDevServer | undefined;
let origin: string;

beforeAll(async () => {
  server = await createServer({
    configFile: resolve("vite.preview-design.config.ts"),
    logLevel: "silent",
    // HTTP entry checks do not need a dependency scan or its background worker.
    optimizeDeps: { entries: [], noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, open: false, watch: null },
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
}, 15000);

afterAll(async () => {
  await server?.close();
});

describe("design preview entry isolation", () => {
  it.each([
    "/",
    "/index.html",
    "/inventory",
    "/inventory/stock",
    "/login?redirect-to=%2Finventory",
    "/inventory/auth-complete",
    "/auth-complete",
  ])(
    "opens the playground from %s without an authenticated session",
    async (path) => {
      const redirect = await fetch(`${origin}${path}`, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("location")).toBe("/design-preview.html");
      expect(redirect.headers.get("cache-control")).toBe("no-store");
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('id="design-preview"');
      expect(html).toContain("/src/design-preview/main.ts");
      expect(html).not.toContain('src="/src/main.ts');
    },
  );

  it("serves the direct entry and its Vue module", async () => {
    const response = await fetch(`${origin}/design-preview.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("物资 · 设计评审");
    const module = await fetch(`${origin}/src/design-preview/main.ts`);
    expect(module.status).toBe(200);
    const source = await module.text();
    expect(source).toContain("PreviewApp.vue");
    expect(source).not.toContain("refreshSession");
  });

  it.each(["/api/method/frappe.auth.get_logged_user", "/not-a-preview-route"])(
    "returns a real 404 instead of booting the production app for %s",
    async (path) => {
      for (const method of ["GET", "POST"]) {
        const response = await fetch(`${origin}${path}`, {
          method,
          headers: { Accept: "text/html" },
        });
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("/src/main.ts");
      }
    },
  );
});
