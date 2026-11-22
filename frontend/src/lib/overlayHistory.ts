import type { RouteLocationRaw, Router } from "vue-router";

type OverlayPopHandler = (event: PopStateEvent) => void;

let navigationPending = false;
let popstateTraversal = false;
let replacingOverlayNavigation = false;
let committedHref = typeof window === "undefined" ? "" : window.location.href;
let currentOverlayMarker: string | undefined;
const overlayPopHandlers = new Map<string, OverlayPopHandler>();
// A closing overlay steps Back over its own history entry; the browser delivers that popstate
// later. A navigation started in between would be written onto the overlay entry and then
// undone by the Back, so router navigations wait until the Back has landed.
const OVERLAY_BACK_TIMEOUT_MS = 500;
let overlayBack: Promise<void> | undefined;
let releaseOverlayBack: (() => void) | undefined;

function markerFrom(state: unknown) {
  if (!state || typeof state !== "object") return undefined;
  const marker = (state as { tiOverlay?: unknown }).tiOverlay;
  return typeof marker === "string" ? marker : undefined;
}

function capturePopstate(event: PopStateEvent) {
  // Release after this popstate's own listeners, including Vue Router's, have run.
  if (releaseOverlayBack) setTimeout(releaseOverlayBack, 0);
  const destinationMarker = markerFrom(event.state);
  const previousMarker = currentOverlayMarker;
  const sameCommittedUrl = window.location.href === committedHref;
  const markerTransition =
    previousMarker !== destinationMarker &&
    Boolean(previousMarker || destinationMarker);
  if (sameCommittedUrl && markerTransition) {
    event.stopImmediatePropagation();
    currentOverlayMarker = destinationMarker;
    if (previousMarker) overlayPopHandlers.get(previousMarker)?.(event);
    return;
  }
  popstateTraversal = true;
  currentOverlayMarker = destinationMarker;
}

// Register at module evaluation: router.ts imports this module before creating
// createWebHistory(), whose window popstate listener is non-capture.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", capturePopstate, true);
}

export function registerOverlayMarker(id: string, onPop: OverlayPopHandler) {
  overlayPopHandlers.set(id, onPop);
  currentOverlayMarker = id;
  return () => {
    if (overlayPopHandlers.get(id) === onPop) overlayPopHandlers.delete(id);
  };
}

export function trackOverlayMarker(id: string | undefined) {
  currentOverlayMarker = id;
}

/** Called by an overlay right before it steps Back over its own history entry. */
export function expectOverlayBack() {
  if (overlayBack) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  overlayBack = new Promise<void>((resolve) => {
    releaseOverlayBack = () => {
      if (timer) clearTimeout(timer);
      overlayBack = undefined;
      releaseOverlayBack = undefined;
      resolve();
    };
  });
  // History.back() can be a no-op (no earlier entry); never hold navigation for long.
  timer = setTimeout(() => releaseOverlayBack?.(), OVERLAY_BACK_TIMEOUT_MS);
}

export function isOverlayNavigationPending() {
  return navigationPending;
}

function replaceOverlayNavigation(
  target: RouteLocationRaw,
): RouteLocationRaw | void {
  if (replacingOverlayNavigation) {
    replacingOverlayNavigation = false;
    return;
  }
  if (
    !popstateTraversal &&
    typeof history !== "undefined" &&
    markerFrom(history.state)
  ) {
    const state = { ...history.state };
    delete state.tiOverlay;
    history.replaceState(state, "");
    currentOverlayMarker = undefined;
    replacingOverlayNavigation = true;
    return typeof target === "string"
      ? { path: target, replace: true }
      : { ...target, replace: true };
  }
}

export function installOverlayHistory(router: Router) {
  committedHref = window.location.href;
  currentOverlayMarker = markerFrom(history.state);
  const removeAfter = router.afterEach(() => {
    navigationPending = false;
    popstateTraversal = false;
    replacingOverlayNavigation = false;
    committedHref = window.location.href;
    currentOverlayMarker = markerFrom(history.state);
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
  const push = router.push;
  const replace = router.replace;
  router.push = (to) =>
    overlayBack
      ? overlayBack.then(() => push.call(router, to))
      : push.call(router, to);
  router.replace = (to) =>
    overlayBack
      ? overlayBack.then(() => replace.call(router, to))
      : replace.call(router, to);
  return () => {
    router.push = push;
    router.replace = replace;
    removeBefore();
    removeAfter();
    removeError();
    navigationPending = false;
    popstateTraversal = false;
    replacingOverlayNavigation = false;
  };
}
