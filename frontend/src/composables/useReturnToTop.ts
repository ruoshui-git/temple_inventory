import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";

export interface ReturnToTopOptions {
  root: Ref<HTMLElement | undefined>;
  heading: Ref<HTMLElement | undefined>;
  hidden?: () => boolean;
}

/** Tracks the currently mounted result surface without moving controller state. */
export function useReturnToTop({
  root,
  heading,
  hidden = () => false,
}: ReturnToTopOptions) {
  const scrollTop = ref(0);
  const viewportHeight = ref(0);
  let observer: ResizeObserver | undefined;
  let observedRoot: HTMLElement | undefined;

  const visible = computed(
    () =>
      !hidden() &&
      viewportHeight.value > 0 &&
      scrollTop.value > viewportHeight.value * 2,
  );
  const update = () => {
    const target = root.value;
    scrollTop.value = target?.scrollTop ?? window.scrollY ?? 0;
    viewportHeight.value = target?.clientHeight ?? window.innerHeight;
  };
  const onWindowScroll = () => update();
  const onResize = () => update();
  const onRootScroll = () => update();

  function attachRoot() {
    if (observedRoot) observedRoot.removeEventListener("scroll", onRootScroll);
    observedRoot = root.value;
    observedRoot?.addEventListener("scroll", onRootScroll, { passive: true });
    observer?.disconnect();
    if (observedRoot && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(observedRoot);
    }
    update();
  }

  function returnToTop() {
    const target = root.value;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (target)
      target.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    else
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    requestAnimationFrame(() => heading.value?.focus({ preventScroll: true }));
  }

  onMounted(() => {
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    attachRoot();
  });
  const stop = watch(root, attachRoot, { flush: "post" });
  onBeforeUnmount(() => {
    window.removeEventListener("scroll", onWindowScroll);
    window.removeEventListener("resize", onResize);
    observedRoot?.removeEventListener("scroll", onRootScroll);
    observer?.disconnect();
    stop();
  });

  return { visible, returnToTop, refresh: update };
}
