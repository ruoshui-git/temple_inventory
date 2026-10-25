import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export function useOverflowEdges(element: Ref<HTMLElement | undefined>) {
  const overflowStart = ref(false);
  const overflowEnd = ref(false);
  // Distance from the scrollport's right edge to its pinned end columns, so
  // overlays such as the "more columns" hint never cover pinned headers.
  const pinnedEndInset = ref(0);
  const pinnedStartInset = ref(0);
  let observer: ResizeObserver | undefined;

  function measure() {
    const node = element.value;
    if (!node) {
      overflowStart.value = false;
      overflowEnd.value = false;
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
    for (const cell of Array.from(node.querySelectorAll<HTMLElement>("thead th"))) {
      const style = getComputedStyle(cell);
      if (style.position !== "sticky" || style.left === "auto") continue;
      startInset = Math.max(startInset, cell.getBoundingClientRect().right - node.getBoundingClientRect().left);
    }
    pinnedEndInset.value = Math.round(inset);
    pinnedStartInset.value = Math.round(startInset);
  }
  function scrollMore(direction: -1 | 1) {
    const node = element.value;
    if (!node) return;
    const behavior: ScrollBehavior = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
      ? "instant"
      : "smooth";
    node.scrollBy({ left: Math.round(node.clientWidth * 0.8) * direction, behavior });
  }
  onMounted(() => {
    measure();
    const node = element.value;
    if (!node) return;
    node.addEventListener("scroll", measure, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(node);
      if (node.firstElementChild) observer.observe(node.firstElementChild);
    }
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    element.value?.removeEventListener("scroll", measure);
  });
  return { overflowStart, overflowEnd, pinnedStartInset, pinnedEndInset, measure, scrollMore };
}
