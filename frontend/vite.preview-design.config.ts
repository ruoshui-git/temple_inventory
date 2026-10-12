import { fileURLToPath, URL } from "node:url";
import {
  defineConfig,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from "vite";
import vue from "@vitejs/plugin-vue";

function previewEntry(): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url || "/", "http://preview.local")
        .pathname;
      const isAppEntry =
        ["/", "/index.html", "/login", "/auth-complete"].includes(pathname) ||
        /^\/inventory(?:\/|$)/.test(pathname);

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        isAppEntry
      ) {
        // Port forwarding and old app tabs often open the root or /inventory.
        // Never allow those entries to load the production auth bootstrap.
        response.writeHead(302, {
          Location: "/design-preview.html",
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      next();
    });
  };
  return {
    name: "design-preview-entry",
    configureServer: install,
    configurePreviewServer: install,
  };
}

// Deliberately excludes Frappe integration, production entry and PWA plugins.
export default defineConfig({
  plugins: [previewEntry(), vue()],
  // A SPA fallback would serve the production index.html for unknown paths,
  // including /login and failed API requests, and start Frappe authentication.
  appType: "mpa",
  optimizeDeps: { entries: ["design-preview.html"] },
  server: { host: "0.0.0.0", port: 5174, strictPort: true },
  css: { postcss: { plugins: [] } },
  build: {
    outDir: "/tmp/temple-inventory-design-preview",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./design-preview.html", import.meta.url)),
    },
  },
});
