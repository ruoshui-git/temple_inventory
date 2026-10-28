import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { chooseFilterPopoverPlacement } from "../lib/filterPopoverPlacement";

export function useAnchoredPopup(options: {
  anchor: Ref<HTMLElement | undefined>;
  popup: Ref<HTMLElement | undefined>;
  open: Ref<boolean>;
  align?: "start" | "end";
  gap?: number;
  margin?: number;
  minWidth?: number;
  /** Cap on the popup height; content scrolls beyond it. */
  maxHeight?: number;
  /** Stay below the anchor when at least this much height fits there. */
  preferredMinHeight?: number;
  maxWidth?: number;
  onClose: (restoreFocus: boolean) => void;
}) {
  const owner = `popup-${Math.random().toString(36).slice(2)}`;
  const style = ref<Record<string, string>>({ visibility: "hidden" });
  const target = ref<HTMLElement | string>("body");
  let resizeObserver: ResizeObserver | undefined;
  function updateTarget() {
    const overlay = options.anchor.value?.closest<HTMLElement>(
      ".ui-dialog, .overlay-stage-panel",
    );
    target.value = overlay || "body";
  }
  function reposition() {
    const anchor = options.anchor.value;
    const popup = options.popup.value;
    if (!options.open.value || !anchor || !popup || !anchor.isConnected) {
      if (options.open.value && (!anchor || !anchor.isConnected))
        options.onClose(false);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth
    ) {
      options.onClose(false);
      return;
    }
    const margin = options.margin ?? 8;
    const gap = options.gap ?? 4;
    const maxWidth = Math.min(
      options.maxWidth ?? 360,
      window.innerWidth - margin * 2,
    );
    // Measure the content width, not the stretched block or a prior placement.
    const appliedWidth = popup.style.width;
    popup.style.width = "max-content";
    const naturalWidth = Math.ceil(popup.getBoundingClientRect().width);
    popup.style.width = appliedWidth;
    const width = Math.min(
      Math.max(naturalWidth, options.minWidth ?? rect.width),
      maxWidth,
    );
    const naturalHeight = Math.min(
      Math.max(popup.scrollHeight, popup.getBoundingClientRect().height),
      options.maxHeight ?? Infinity,
    );
    const placement = chooseFilterPopoverPlacement({
      triggerTop: rect.top,
      triggerBottom: rect.bottom,
      viewportHeight: window.innerHeight,
      naturalHeight,
      margin,
      gap,
      minimumHeight:
        options.preferredMinHeight ?? Math.max(0, naturalHeight - 2),
      triggerLeft: rect.left,
      triggerRight: rect.right,
      viewportWidth: window.innerWidth,
      popupWidth: width,
      align: options.align ?? "start",
      horizontalMargin: margin,
    });
    const maxHeight = Math.min(
      placement.maxHeight,
      options.maxHeight ?? Infinity,
    );
    style.value = {
      position: "fixed",
      left: `${placement.left ?? margin}px`,
      top: `${placement.top}px`,
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
      "--popup-max-height": `${maxHeight}px`,
      visibility: "visible",
    };
  }
  function otherPopup(event: Event) {
    if ((event as CustomEvent).detail !== owner) options.onClose(false);
  }
  function outside(event: PointerEvent) {
    if (!options.open.value || !(event.target instanceof Node)) return;
    if (
      options.anchor.value?.contains(event.target) ||
      options.popup.value?.contains(event.target)
    )
      return;
    options.onClose(false);
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !options.open.value || event.defaultPrevented)
      return;
    event.preventDefault();
    event.stopPropagation();
    options.onClose(true);
  }
  function routeChanged() {
    options.onClose(false);
  }
  // Listeners exist only while open: editors mount hundreds of closed selectors.
  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener("browse-filter-panel-open", otherPopup);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown);
    document.addEventListener("inventory-navigation", routeChanged);
    window.addEventListener("popstate", routeChanged);
    window.addEventListener("hashchange", routeChanged);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver ??= new ResizeObserver(reposition);
      if (options.popup.value) resizeObserver.observe(options.popup.value);
    }
  }
  function unlisten() {
    if (!listening) return;
    listening = false;
    resizeObserver?.disconnect();
    document.removeEventListener("browse-filter-panel-open", otherPopup);
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keydown);
    document.removeEventListener("inventory-navigation", routeChanged);
    window.removeEventListener("popstate", routeChanged);
    window.removeEventListener("hashchange", routeChanged);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  }
  watch(options.open, async (isOpen) => {
    if (!isOpen) {
      unlisten();
      return;
    }
    document.dispatchEvent(
      new CustomEvent("browse-filter-panel-open", { detail: owner }),
    );
    updateTarget();
    await nextTick();
    if (!options.open.value) return;
    listen();
    reposition();
  });
  watch(options.anchor, (anchor) => {
    if (options.open.value && !anchor) options.onClose(false);
    else reposition();
  });
  onBeforeUnmount(unlisten);
  return { owner, style, target, reposition };
}
