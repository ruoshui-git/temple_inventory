import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** Keeps compact browse chrome in sync with the active result surface. */
export function useCompactBrowse(
  root: Ref<HTMLElement | undefined>,
  state: Ref<boolean> = ref(false),
) {
  let resizeObserver: ResizeObserver | undefined;
  let observedRoot: HTMLElement | undefined;

  function update() {
    state.value = (root.value?.scrollTop ?? window.scrollY ?? 0) > 80;
  }

  function attachRoot() {
    if (observedRoot) observedRoot.removeEventListener("scroll", update);
    observedRoot = root.value;
    observedRoot?.addEventListener("scroll", update, { passive: true });
    resizeObserver?.disconnect();
    if (observedRoot && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(observedRoot);
    }
    update();
  }

  onMounted(attachRoot);
  const stop = watch(root, attachRoot, { flush: "post" });
  onBeforeUnmount(() => {
    observedRoot?.removeEventListener("scroll", update);
    resizeObserver?.disconnect();
    stop();
  });

  return { compact: state, refresh: update };
}
