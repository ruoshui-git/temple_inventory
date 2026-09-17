import { createRouter, createWebHistory } from 'vue-router'
export const router = createRouter({ history: createWebHistory('/inventory'), routes: [{ path: '/:pathMatch(.*)*', component: () => import('./pages/Inventory.vue') }] })
