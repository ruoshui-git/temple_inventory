import { createRouter, createWebHistory } from "vue-router";
import { watch } from "vue";
import {
  breadcrumbsForRoute,
  guardReservedRoute,
  routeRecords,
} from "./lib/routeRegistry";
import { installOverlayHistory } from "./lib/overlayHistory";
import { activeRouteBreadcrumbLabel } from "./lib/routeBreadcrumbLabel";
import { environment } from "./lib/environment";

export const router = createRouter({
  history: createWebHistory("/inventory"),
  routes: routeRecords,
});
router.beforeEach(guardReservedRoute);
installOverlayHistory(router);
function updateDocumentTitle(route = router.currentRoute.value) {
  if (route.name === "home") {
    document.title = environment.title;
    return;
  }
  const pageTitle =
    activeRouteBreadcrumbLabel.value ||
    breadcrumbsForRoute(route).at(-1)?.label ||
    "物资管理";
  document.title = `${environment.title} | ${pageTitle}`;
}
router.afterEach(() => {
  activeRouteBreadcrumbLabel.value = undefined;
  updateDocumentTitle();
});
watch(activeRouteBreadcrumbLabel, () => updateDocumentTitle());
