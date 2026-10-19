import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  type Ref,
} from "vue";
import { scrollOwner, scrollBy } from "./scrollSurface";

export function useFocusVisibility(
  root: Ref<HTMLElement | undefined>,
  review: Ref<HTMLElement | undefined>,
  fixedReview: () => boolean,
  active: () => boolean,
  topChrome?: Ref<HTMLElement | undefined>,
) {
  let observer: ResizeObserver | undefined;
  let frame = 0;
  let listening = false;
  let generation = 0;
  function reveal() {
    frame = 0;
    if (!listening || !root.value) return;
    const nav = document.querySelector<HTMLElement>(".sample-mobile-nav");
    const navRect = nav?.getBoundingClientRect();
    const navHeight = navRect?.height || 0;
    const editorRect = root.value.getBoundingClientRect();
    root.value.style.setProperty(
      "--preview-editor-left",
      `${Math.max(12, editorRect.left)}px`,
    );
    root.value.style.setProperty(
      "--preview-editor-right",
      `${Math.max(12, window.innerWidth - editorRect.right)}px`,
    );
    root.value.style.setProperty("--preview-nav-height", `${navHeight}px`);
    root.value.style.setProperty(
      "--preview-review-height",
      `${review.value?.getBoundingClientRect().height || 0}px`,
    );
    const field = document.activeElement;
    if (
      !(field instanceof HTMLElement) ||
      !root.value.contains(field) ||
      review.value?.contains(field)
    )
      return;
    if (topChrome?.value?.contains(field) && field.matches("h1, h2")) {
      const chromeRect = field.getBoundingClientRect();
      if (chromeRect.top >= 0 && chromeRect.bottom <= window.innerHeight)
        return;
    }
    const rect = field.getBoundingClientRect();
    const reviewRect = review.value?.getBoundingClientRect();
    let bottom =
      Math.min(
        window.innerHeight,
        navRect?.top ?? window.innerHeight,
        fixedReview() &&
          reviewRect &&
          rect.right > reviewRect.left &&
          rect.left < reviewRect.right
          ? reviewRect.top
          : window.innerHeight,
      ) - 12;
    for (const action of Array.from(
      document.querySelectorAll<HTMLElement>(
        ".current-fab > button, .browse-mobile-fab-trigger, .preview-return-top",
      ),
    )) {
      if (action === field || !action.getClientRects().length) continue;
      const actionRect = action.getBoundingClientRect();
      if (rect.right > actionRect.left && rect.left < actionRect.right)
        bottom = Math.min(bottom, actionRect.top - 12);
    }
    const owner = scrollOwner(field);
    let edge =
      owner === window
        ? 12
        : (owner as HTMLElement).getBoundingClientRect().top + 12;
    if (topChrome?.value && !topChrome.value.contains(field))
      edge = Math.max(
        edge,
        topChrome.value.getBoundingClientRect().bottom + 12,
      );
    if (rect.bottom > bottom) scrollBy(owner, rect.bottom - bottom);
    else if (rect.top < edge) scrollBy(owner, rect.top - edge);
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(reveal);
  }
  function stop() {
    generation++;
    listening = false;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    observer = undefined;
    root.value?.removeEventListener("focusin", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("inventory-text-scale", schedule);
  }
  async function start() {
    stop();
    // KeepAlive calls both mounted and activated on its first mount.
    const startingGeneration = generation;
    await nextTick();
    if (
      startingGeneration !== generation ||
      !active() ||
      !root.value?.isConnected
    )
      return;
    listening = true;
    root.value.addEventListener("focusin", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("inventory-text-scale", schedule);
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(root.value);
      if (review.value) observer.observe(review.value);
      if (topChrome?.value) observer.observe(topChrome.value);
      const nav = document.querySelector(".sample-mobile-nav");
      if (nav) observer.observe(nav);
    }
    schedule();
  }
  onMounted(start);
  onActivated(start);
  onDeactivated(stop);
  onBeforeUnmount(stop);
  watch([active, fixedReview], start);
}
