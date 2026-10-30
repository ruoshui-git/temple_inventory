import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export function edgeIsOverflowing(gap: number, wasOverflowing: boolean) {
  return gap > (wasOverflowing ? 1 : 8);
}

export function useOverflowEdges(
  element: Ref<HTMLElement | undefined>,
  frame: Ref<HTMLElement | undefined>,
) {
  const overflowStart = ref(false);
  const overflowEnd = ref(false);
  // Distance from the scrollport's right edge to its pinned end columns, so
  // overlays such as the "more columns" hint never cover pinned headers.
  const pinnedEndInset = ref(0);
  const pinnedStartInset = ref(0);
  const mobileUnpinEnd = ref(false);
  const hintTop = ref(0);
  const hintLeft = ref(0);
  const hintRight = ref(0);
  const hintVisible = ref(false);
  let observer: ResizeObserver | undefined;
  let measureFrame = 0;

  function measureNow() {
    const node = element.value;
    if (!node) {
      overflowStart.value = false;
      overflowEnd.value = false;
      hintVisible.value = false;
      mobileUnpinEnd.value = false;
      return;
    }
    const max = node.scrollWidth - node.clientWidth;
    const leftGap = node.scrollLeft;
    const rightGap = max - node.scrollLeft;
    overflowStart.value =
      max > 1 && edgeIsOverflowing(leftGap, overflowStart.value);
    overflowEnd.value =
      max > 1 && edgeIsOverflowing(rightGap, overflowEnd.value);
    const headers = Array.from(node.querySelectorAll<HTMLElement>("thead th"));
    const endWidth = headers
      .filter((cell) => cell.classList.contains("data-table-pinned-end"))
      .reduce((width, cell) => width + cell.offsetWidth, 0);
    const settingsWidth =
      headers.find((cell) =>
        cell.classList.contains("data-table-settings-heading"),
      )?.offsetWidth ?? 0;
    const inset = endWidth + settingsWidth;
    const startInset = headers
      .filter(
        (cell) =>
          cell.classList.contains("data-table-pinned-start") ||
          cell.classList.contains("data-table-selection-pinned"),
      )
      .reduce((width, cell) => width + cell.offsetWidth, 0);
    const phone =
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 1023px)").matches) ||
      window.innerWidth < 1024;
    mobileUnpinEnd.value = phone && endWidth > node.clientWidth * 0.45;
    pinnedEndInset.value = mobileUnpinEnd.value ? 0 : Math.round(inset);
    pinnedStartInset.value = Math.round(startInset);
    const frameNode = frame.value;
    if (frameNode) {
      const rect = frameNode.getBoundingClientRect();
      const hasLayout =
        frameNode.isConnected &&
        frameNode.offsetParent !== null &&
        rect.width > 0 &&
        rect.height > 0;
      const chrome = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".browse-chrome.is-stuck, .app-sidebar, .mobile-app-topbar",
        ),
      ).reduce((bottom, item) => {
        const box = item.getBoundingClientRect();
        return box.height && box.top <= 1 && box.bottom > 0
          ? Math.max(bottom, box.bottom)
          : bottom;
      }, 0);
      const mobileNav = document.querySelector<HTMLElement>(".app-mobile-nav");
      const bottomLimit =
        mobileNav?.getBoundingClientRect().top ?? window.innerHeight;
      hintVisible.value =
        !phone && hasLayout && rect.bottom > chrome && rect.top < bottomLimit;
      const visibleTop = Math.max(rect.top + 16, chrome + 14);
      const visibleBottom = Math.min(rect.bottom - 16, bottomLimit - 14);
      hintTop.value =
        visibleBottom < visibleTop
          ? Math.min(Math.max(rect.top + 28, chrome + 28), bottomLimit - 28)
          : Math.round((visibleTop + visibleBottom) / 2);
      hintLeft.value = Math.round(rect.left + pinnedStartInset.value + 8);
      hintRight.value = Math.round(
        window.innerWidth - rect.right + pinnedEndInset.value + 8,
      );
    }
  }
  function measure() {
    if (measureFrame) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      measureNow();
    });
  }
  function scrollMore(direction: -1 | 1) {
    const node = element.value;
    if (!node) return;
    const behavior: ScrollBehavior = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
      ? "instant"
      : "smooth";
    node.scrollBy({
      left: Math.round(node.clientWidth * 0.8) * direction,
      behavior,
    });
  }
  onMounted(() => {
    measure();
    const node = element.value;
    if (!node) return;
    node.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("scroll", measure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", measure, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(node);
      if (node.firstElementChild) observer.observe(node.firstElementChild);
      if (frame.value) observer.observe(frame.value);
    }
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    element.value?.removeEventListener("scroll", measure);
    window.removeEventListener("scroll", measure, true);
    window.removeEventListener("resize", measure);
    if (measureFrame) cancelAnimationFrame(measureFrame);
  });
  return {
    overflowStart,
    overflowEnd,
    pinnedStartInset,
    pinnedEndInset,
    mobileUnpinEnd,
    hintTop,
    hintLeft,
    hintRight,
    hintVisible,
    measure,
    scrollMore,
  };
}
