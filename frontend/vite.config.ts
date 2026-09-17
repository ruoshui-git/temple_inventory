import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'

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
    frappeui({
      // Route this SPA is served on by Frappe. Drives the dev-server banner and
      // the auto-inferred indexHtmlPath.
      frontendRoute: '/inventory',
    }),
    vue(),
  ],
  server: {
    // Vite's default host is `localhost`, which resolves to IPv6 `::1` only in
    // this bench container: the dev server is then unreachable on 127.0.0.1 and
    // through dev container port forwarding. Bind all interfaces instead (this
    // is what erpnext/banking does too). `allowedHosts` needs no change: Vite
    // always allows `localhost` and any `*.localhost` host.
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
