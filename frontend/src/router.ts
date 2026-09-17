import { createRouter, createWebHistory } from 'vue-router'
export const router = createRouter({ history: createWebHistory('/inventory'), routes: [
  { path: '/', component: () => import('./pages/Inventory.vue') },
  { path: '/new/:kind', component: () => import('./pages/Workspace.vue') },
  { path: '/workspace/:name', component: () => import('./pages/Workspace.vue') },
  { path: '/entry/:entry', component: () => import('./pages/Workspace.vue') },
  { path: '/settings', component: () => import('./pages/Settings.vue') },
  { path: '/history', component: () => import('./pages/History.vue') },
  { path: '/item/:code', component: () => import('./pages/ItemDetail.vue') },
  { path: '/auth-complete', component: { template: '<main class="app-shell"><h1>登录成功</h1><p>请返回原窗口并点击「继续保存」。</p></main>' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
] })
