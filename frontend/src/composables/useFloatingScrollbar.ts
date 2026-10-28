import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";

export function shouldShowFloatingScrollbar(
  rect: Pick<DOMRect, "top" | "bottom">,
  viewportHeight: number,
  chromeBottom: number,
  overflowing: boolean,
) {
  return (
    overflowing &&
    rect.top < viewportHeight &&
    rect.bottom > chromeBottom &&
    rect.bottom > viewportHeight + 0.5
  );
}

export function useFloatingScrollbar(
  element: Ref<HTMLElement | undefined>,
  proxyElement: Ref<HTMLElement | undefined>,
) {
  const visible = ref(false);
  const left = ref(0);
  const width = ref(0);
  const spacerWidth = ref(0);
  const thumbPercentWidth = ref(100);
  const thumbPercentLeft = ref(0);
  let observer: ResizeObserver | undefined;
  let observedNode: HTMLElement | undefined;
  let frame = 0;
  let syncing = false;
  let lastProxyWrite: number | undefined;

  function measure() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const node = element.value;
      if (
        !node ||
        typeof window.matchMedia !== "function" ||
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches
      ) {
        visible.value = false;
        return;
      }
      const rect = node.getBoundingClientRect();
      const overflowing = node.scrollWidth > node.clientWidth + 1;
      const chromeBottom = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".browse-chrome.is-stuck, .app-sidebar, .mobile-app-topbar",
        ),
      ).reduce((bottom, item) => {
        const box = item.getBoundingClientRect();
        return box.height && box.top <= 1 && box.bottom > 0
          ? Math.max(bottom, box.bottom)
          : bottom;
      }, 0);
      left.value = Math.round(rect.left);
      width.value = Math.round(rect.width);
      spacerWidth.value = node.scrollWidth;
      thumbPercentWidth.value = Math.min(
        100,
        (node.clientWidth / node.scrollWidth) * 100,
      );
      const maxScroll = node.scrollWidth - node.clientWidth;
      thumbPercentLeft.value =
        maxScroll > 0
          ? (node.scrollLeft / maxScroll) * (100 - thumbPercentWidth.value)
          : 0;
      if (proxyElement.value && !syncing) {
        syncing = true;
        lastProxyWrite = node.scrollLeft;
        proxyElement.value.scrollLeft = lastProxyWrite;
        syncing = false;
      }
      visible.value = shouldShowFloatingScrollbar(
        rect,
        window.innerHeight,
        chromeBottom,
        overflowing,
      );
    });
  }

  function fromProxy(event: Event) {
    const node = element.value;
    const proxy = event.currentTarget as HTMLElement;
    if (!node || syncing) return;
    if (
      lastProxyWrite !== undefined &&
      Math.abs(proxy.scrollLeft - lastProxyWrite) <= 1
    ) {
      lastProxyWrite = undefined;
      return;
    }
    lastProxyWrite = undefined;
    syncing = true;
    node.scrollLeft = proxy.scrollLeft;
    syncing = false;
  }

  function fromTable() {
    // The proxy's bound element reads this value during each shared render.
    if (syncing) return;
    measure();
  }

  function attach(node: HTMLElement | undefined) {
    if (node === observedNode) return;
    observedNode?.removeEventListener("scroll", fromTable);
    observer?.disconnect();
    observedNode = node;
    if (!node) return;
    node.addEventListener("scroll", fromTable, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(node);
      if (node.firstElementChild) observer.observe(node.firstElementChild);
    }
    measure();
  }
  watch(element, attach, { immediate: true });
  watch(visible, (value) => {
    document.documentElement.classList.toggle(
      "has-floating-table-scrollbar",
      value,
    );
  });
  watch(proxyElement, (proxy) => {
    const node = element.value;
    if (node && proxy) {
      lastProxyWrite = node.scrollLeft;
      proxy.scrollLeft = lastProxyWrite;
    }
  });

  onMounted(() => {
    attach(element.value);
    window.addEventListener("scroll", measure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", measure, { passive: true });
    measure();
  });
  onBeforeUnmount(() => {
    observedNode?.removeEventListener("scroll", fromTable);
    observer?.disconnect();
    window.removeEventListener("scroll", measure, true);
    window.removeEventListener("resize", measure);
    if (frame) cancelAnimationFrame(frame);
    document.documentElement.classList.remove("has-floating-table-scrollbar");
  });

  return {
    visible,
    style: computed(() => ({
      left: `${left.value}px`,
      width: `${width.value}px`,
    })),
    thumbStyle: computed(() => ({
      left: `${thumbPercentLeft.value}%`,
      width: `${thumbPercentWidth.value}%`,
    })),
    spacerWidth,
    fromProxy,
    proxyElement,
  };
}
