import { nextTick, onDeactivated, ref, watch, type Ref } from "vue";
/** Layout-only mode. The same editor and all of its allocations stay mounted. */
export function usePreviewWorkspace(
  root: Ref<HTMLElement | undefined>,
  active: () => boolean,
) {
  const expanded = ref(false);
  let invoker: HTMLElement | null = null;
  let scroll: Array<[HTMLElement, number]> = [];
  async function toggle() {
    if (!expanded.value) {
      invoker = document.activeElement as HTMLElement;
      scroll = [];
      for (
        let element = root.value;
        element;
        element = element.parentElement || undefined
      )
        scroll.push([element, element.scrollTop]);
      expanded.value = true;
      await nextTick();
      root.value?.scrollIntoView?.({ block: "start" });
    } else {
      expanded.value = false;
      await nextTick();
      scroll.forEach(([element, top]) => {
        element.scrollTop = top;
      });
      invoker?.focus({ preventScroll: true });
    }
  }
  watch(active, (value) => {
    if (!value) expanded.value = false;
  });
  onDeactivated(() => {
    expanded.value = false;
  });
  return { expanded, toggle };
}
