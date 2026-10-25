import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

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
      return;
    }
    const max = node.scrollWidth - node.clientWidth;
    overflowStart.value = max > 1 && node.scrollLeft > 1;
    overflowEnd.value = max > 1 && node.scrollLeft < max - 1;
    const right = node.getBoundingClientRect().right;
    let inset = 0;
    let startInset = 0;
    for (const cell of Array.from(
      node.querySelectorAll<HTMLElement>("thead th"),
    )) {
      const style = getComputedStyle(cell);
      if (style.position !== "sticky" || style.right === "auto") continue;
      inset = Math.max(inset, right - cell.getBoundingClientRect().left);
    }
    for (const cell of Array.from(
      node.querySelectorAll<HTMLElement>("thead th"),
    )) {
      const style = getComputedStyle(cell);
      if (style.position !== "sticky" || style.left === "auto") continue;
      startInset = Math.max(
        startInset,
        cell.getBoundingClientRect().right - node.getBoundingClientRect().left,
      );
    }
    pinnedEndInset.value = Math.round(inset);
    pinnedStartInset.value = Math.round(startInset);
    const frameNode = frame.value;
    if (frameNode) {
      const rect = frameNode.getBoundingClientRect();
      const chrome = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".browse-chrome.is-stuck, .sample-sidebar, .mobile-app-topbar",
        ),
      ).reduce((bottom, item) => {
        const box = item.getBoundingClientRect();
        return box.height && box.top <= 1 && box.bottom > 0
          ? Math.max(bottom, box.bottom)
          : bottom;
      }, 0);
      const mobileNav =
        document.querySelector<HTMLElement>(".sample-mobile-nav");
      const bottomLimit =
        mobileNav?.getBoundingClientRect().top ?? window.innerHeight;
      hintVisible.value = rect.bottom > chrome && rect.top < bottomLimit;
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
    hintTop,
    hintLeft,
    hintRight,
    hintVisible,
    measure,
    scrollMore,
  };
}
