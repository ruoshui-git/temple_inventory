import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from "vue";

export type PreviewScrollOwner = HTMLElement | Window;
export function previewScrollOwner(
  element: HTMLElement | null,
): PreviewScrollOwner {
  for (let node = element; node; node = node.parentElement) {
    if (
      /(auto|scroll)/.test(getComputedStyle(node).overflowY) &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return window;
}
export function scrollTop(owner: PreviewScrollOwner) {
  return owner === window ? window.scrollY : (owner as HTMLElement).scrollTop;
}
export function scrollHeight(owner: PreviewScrollOwner) {
  return owner === window
    ? window.innerHeight
    : (owner as HTMLElement).clientHeight;
}
export function scrollBy(owner: PreviewScrollOwner, top: number) {
  owner.scrollBy({ top, behavior: "instant" });
}

// KeepAlive and v-show surfaces must release listeners while they are inactive.
export function usePreviewScroll(
  root: Ref<HTMLElement | undefined>,
  active: () => boolean = () => true,
) {
  const top = ref(0);
  const viewport = ref(0);
  const owner = shallowRef<PreviewScrollOwner>();
  let listening = false;
  let generation = 0;
  function measure() {
    if (!listening || !root.value) return;
    owner.value = previewScrollOwner(root.value);
    top.value = scrollTop(owner.value);
    viewport.value = scrollHeight(owner.value);
  }
  function stop() {
    generation++;
    listening = false;
    window.removeEventListener("scroll", measure, true);
    window.removeEventListener("resize", measure);
  }
  async function start() {
    stop();
    // A later activation or stop invalidates an earlier pending start.
    const startingGeneration = generation;
    await nextTick();
    if (
      startingGeneration !== generation ||
      !active() ||
      !root.value?.isConnected
    )
      return;
    listening = true;
    window.addEventListener("scroll", measure, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", measure);
    measure();
  }
  onMounted(start);
  onActivated(start);
  onDeactivated(stop);
  onBeforeUnmount(stop);
  watch(active, (value) => (value ? start() : stop()));
  return { top, viewport, owner };
}
