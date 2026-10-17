import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history: createWebHistory("/inventory"),
  routes: [
    {
      path: "/documents/:doctype/:name",
      component: () => import("./pages/NativeDocument.vue"),
    },
    {
      path: "/item/:code/edit",
      component: () => import("./pages/NewItem.vue"),
    },
    { path: "/activities", component: () => import("./pages/Activities.vue") },
    {
      path: "/activities/new",
      component: () => import("./pages/Activities.vue"),
    },
    {
      path: "/activities/:name/edit",
      component: () => import("./pages/Activities.vue"),
    },
    {
      path: "/activities/:name",
      component: () => import("./pages/Activities.vue"),
    },
    { path: "/", component: () => import("./pages/Dashboard.vue") },
    { path: "/stock", component: () => import("./pages/Inventory.vue") },
    { path: "/loans/items", component: () => import("./pages/Loans.vue") },
    { path: "/loans/records", component: () => import("./pages/Loans.vue") },
    { path: "/loans/:name", component: () => import("./pages/LoanDetail.vue") },
    { path: "/warehouses", component: () => import("./pages/Warehouses.vue") },
    {
      path: "/warehouses/:warehouse",
      component: () => import("./pages/WarehouseDetail.vue"),
    },
    { path: "/more", component: () => import("./pages/More.vue") },
    { path: "/reports", component: () => import("./pages/Reports.vue") },
    { path: "/pending", component: () => import("./pages/Pending.vue") },
    {
      path: "/drafts",
      component: () => import("./pages/NativeRecords.vue"),
    },
    { path: "/counts", component: () => import("./pages/NativeRecords.vue") },
    {
      path: "/new/:kind",
      component: () => import("./pages/NativeOperation.vue"),
    },
    {
      path: "/reconcile/new",
      component: () => import("./pages/Reconciliation.vue"),
    },
    {
      path: "/reconcile/:name",
      component: () => import("./pages/Reconciliation.vue"),
    },
    { path: "/settings", component: () => import("./pages/Settings.vue") },
    { path: "/setup", component: () => import("./pages/Setup.vue") },
    {
      path: "/movements/items",
      component: () => import("./pages/Movements.vue"),
    },
    {
      path: "/movements/records",
      component: () => import("./pages/Movements.vue"),
    },
    { path: "/expiry", component: () => import("./pages/Expiry.vue") },
    { path: "/item/:code", component: () => import("./pages/ItemDetail.vue") },
    { path: "/items/new", component: () => import("./pages/NewItem.vue") },
    {
      path: "/auth-complete",
      component: {
        template:
          '<main class="app-shell"><h1>登录成功</h1><p>请返回原窗口并点击「继续保存」。</p></main>',
      },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
