import { createRouter, createWebHistory } from 'vue-router'

// The base path must match `frontendRoute` in vite.config.ts: that is the URL
// Frappe serves the built bundle on (/assets/temple_inventory/frontend) and the
// www page it is mounted from (temple_inventory/www/inventory.html).
export const router = createRouter({
  history: createWebHistory('/inventory'),
  routes: [
    {
      path: '/',
      name: 'Inventory',
      component: () => import('./pages/Inventory.vue'),
    },
  ],
})
