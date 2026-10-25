import type { RouteLocationRaw, Router } from "vue-router";

let navigationPending = false;
let popstateTraversal = false;
let replacingOverlayNavigation = false;

function markPopstateTraversal() {
  popstateTraversal = true;
}

export function isOverlayNavigationPending() {
  return navigationPending;
}

export function replaceOverlayNavigation(
  target: RouteLocationRaw,
): RouteLocationRaw | void {
  if (replacingOverlayNavigation) {
    replacingOverlayNavigation = false;
    return;
  }
  if (
    !popstateTraversal &&
    typeof history !== "undefined" &&
    history.state &&
    typeof history.state === "object" &&
    history.state.tiOverlay
  ) {
    const state = { ...history.state };
    delete state.tiOverlay;
    history.replaceState(state, "");
    replacingOverlayNavigation = true;
    return typeof target === "string"
      ? { path: target, replace: true }
      : { ...target, replace: true };
  }
}

export function installOverlayHistory(router: Router) {
  window.addEventListener("popstate", markPopstateTraversal, true);
  const removeAfter = router.afterEach(() => {
    navigationPending = false;
    popstateTraversal = false;
    replacingOverlayNavigation = false;
  });
  const removeError = router.onError(() => {
    navigationPending = false;
    popstateTraversal = false;
    replacingOverlayNavigation = false;
  });
  const removeBefore = router.beforeEach((to) => {
    navigationPending = true;
    return replaceOverlayNavigation(to);
  });
  return () => {
    window.removeEventListener("popstate", markPopstateTraversal, true);
    removeBefore();
    removeAfter();
    removeError();
    navigationPending = false;
    popstateTraversal = false;
    replacingOverlayNavigation = false;
  };
}
