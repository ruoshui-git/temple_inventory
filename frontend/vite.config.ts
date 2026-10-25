import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import frappeui from "frappe-ui/vite";
import { VitePWA } from "vite-plugin-pwa";

// `frappe-ui/vite` is the official Frappe UI plugin. Beyond bundling, it wires
// up everything a frontend inside a Frappe app needs:
//   frappeProxy   - dev server: proxies /app, /api, /assets, /files, /private
//                   to the bench web server (port read from
//                   sites/common_site_config.json -> webserver_port)
//   jinjaBootData - production build: appends a Jinja block to index.html that
//                   copies `boot` (set by www/inventory.py) onto `window`
//   buildConfig   - production build: writes the bundle to the app's
//                   public/frontend and copies the built index.html to
//                   <app>/www/<frontendRoute>.html
//                   (here: temple_inventory/www/inventory.html)
export default defineConfig({
  plugins: [
    // frappe-ui's dev-server "site banner" sub-plugin shells out to
    // `bench list-app-sites`, which this bench CLI version doesn't have (only
    // `list-apps`/`list-sites`). It's caught internally and only skips a
    // startup log line, but drop it here to keep dev-server output clean
    // without patching frappe-ui or upgrading the bench CLI.
    frappeui({
      // Keep the built shell at the app route path from both Bench and an
      // isolated worktree checkout.
      frontendRoute: "/inventory",
      buildConfig: { indexHtmlPath: "../temple_inventory/www/inventory.html" },
      frappeProxy: { port: Number(process.env.TI_DEV_PORT) || undefined },
    }).filter(
      (plugin) =>
        !["frappeui-site-banner-plugin", "frappeui-optimize-deps"].includes(
          plugin.name,
        ),
    ),
    vue(),
    {
      name: "temple-inventory-dev-head-defaults",
      apply: "serve",
      transformIndexHtml(html) {
        return html
          .replace("{{ environment.theme_color or '#28684e' }}", "#28684e")
          .replace("{{ environment.short_name or '物资管理' }}", "物资管理")
          .replace("{{ app_title or '物资管理' }}", "物资管理")
          .replace(
            "{{ environment.icons.favicon or '/assets/temple_inventory/logo.png' }}",
            "/assets/temple_inventory/logo.png",
          )
          .replace(
            "{{ environment.icons.apple or '/assets/temple_inventory/frontend/pwa-icons/apple-touch-icon-180.png' }}",
            "/assets/temple_inventory/frontend/pwa-icons/apple-touch-icon-180.png",
          )
          .replace(
            "{{ manifest_url or '/temple-inventory.webmanifest' }}",
            "/temple-inventory.webmanifest",
          );
      },
    },
    {
      name: "temple-inventory-zxing-local-wasm",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith("/zxing-wasm/dist/es/share.js")) return;
        return code.replace(
          /return n \? `https:\/\/fastly\.jsdelivr\.net\/npm\/zxing-wasm@[^`]+` : t \+ e;/,
          "return t + e;",
        );
      },
    },
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: false,
      workbox: {
        importScripts: ["/assets/temple_inventory/frontend/push-handler.js"],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        navigateFallback: null,
        inlineWorkboxRuntime: true,
        modifyURLPrefix: { "": "/assets/temple_inventory/frontend/" },
        globPatterns: [
          "assets/**/*.{js,css,wasm,woff,woff2,ttf,otf}",
          "pwa-icons/**/*.{png,svg}",
        ],
        // Each site links only its own environment's icons; never precache the others.
        globIgnores: ["pwa-icons/{sample,staging,development}-*"],
      },
    }),
  ],
  // frappe-ui's optimizer lists bare transitive dependency names; scope them to
  // frappe-ui for pnpm resolution. Keep them prebundled so late discovery does
  // not reload the page after a toast or dialog opens and clear its module state.
  optimizeDeps: {
    include: [
      "frappe-ui > highlight.js/lib/core",
      "frappe-ui > reka-ui",
      "frappe-ui > vue-sonner",
      "frappe-ui > dompurify",
    ],
  },
  server: {
    // Vite's default host is `localhost`, which resolves to IPv6 `::1` only in
    // this bench container: the dev server is then unreachable on 127.0.0.1 and
    // through dev container port forwarding. Bind all interfaces instead (this
    // is what erpnext/banking does too). `allowedHosts` needs no change: Vite
    // always allows `localhost` and any `*.localhost` host.
    host: "0.0.0.0",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
