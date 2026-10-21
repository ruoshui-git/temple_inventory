import { createRouter, createWebHistory } from "vue-router";
import { guardReservedRoute, routeRecords } from "./lib/routeRegistry";

export const router = createRouter({
  history: createWebHistory("/inventory"),
  routes: routeRecords,
});
router.beforeEach(guardReservedRoute);
