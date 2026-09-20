import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
    {
      name: 'temple-inventory-zxing-local-wasm',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('/zxing-wasm/dist/es/share.js')) return
        return code.replace(/return n \? `https:\/\/fastly\.jsdelivr\.net\/npm\/zxing-wasm@[^`]+` : t \+ e;/, 'return t + e;')
      },
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        id: '/',
        name: '物资管理',
        short_name: '物资管理',
        description: '寺院物资管理',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f5ef',
        theme_color: '#9b571d',
        icons: [
          { src: '/assets/temple_inventory/frontend/pwa-icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/temple_inventory/frontend/pwa-icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/assets/temple_inventory/frontend/pwa-icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        navigateFallback: null,
        inlineWorkboxRuntime: true,
        modifyURLPrefix: { '': '/assets/temple_inventory/frontend/' },
        globPatterns: ['assets/**/*.{js,css,wasm,woff,woff2,ttf,otf}', 'pwa-icons/**/*.{png,svg}'],
      },
    }),
    {
      name: 'temple-inventory-pwa-manifest-path',
      closeBundle: {
        order: 'post',
        handler() {
          const workerPath = fileURLToPath(new URL('../temple_inventory/public/frontend/sw.js', import.meta.url))
          if (!fs.existsSync(workerPath)) return
          const worker = fs.readFileSync(workerPath, 'utf8')
          fs.writeFileSync(workerPath, worker.replaceAll('url:"manifest.webmanifest"', 'url:"/assets/temple_inventory/frontend/manifest.webmanifest"'))
        },
      },
    },
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
