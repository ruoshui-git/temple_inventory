import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type InjectionKey,
  type Ref,
} from "vue";

// Browse cards provide this so a field line can offer 更多 when its clamped text hides part of a value.
export const browseCardTruncatedKey: InjectionKey<Readonly<Ref<boolean>>> =
  Symbol("browseCardTruncated");

/** True while any [data-clamp] descendant of root cuts off its text. Re-measures on resize and content change. */
export function useTextOverflow(root: Ref<HTMLElement | undefined>) {
  const truncated = ref(false);
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;

  function measure() {
    const node = root.value;
    // Template refs become null on unmount, before a pending measure runs.
    truncated.value = node
      ? Array.from(node.querySelectorAll<HTMLElement>("[data-clamp]")).some(
          (element) =>
            element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1,
        )
      : false;
  }
  onMounted(() => {
    const node = root.value;
    if (node && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(node);
    }
    if (node && typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(measure);
      mutationObserver.observe(node, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    void nextTick(measure);
  });
  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  });
  return truncated;
}
