import { createRouter, createWebHistory } from "vue-router";
import { guardReservedRoute, routeRecords } from "./lib/routeRegistry";
import { installOverlayHistory } from "./lib/overlayHistory";

export const router = createRouter({
  history: createWebHistory("/inventory"),
  routes: routeRecords,
});
router.beforeEach(guardReservedRoute);
installOverlayHistory(router);
