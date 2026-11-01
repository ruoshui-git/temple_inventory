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
  let viewport: VisualViewport | null = null;
  function syncLayoutVariables() {
    const editor = root.value;
    if (!editor) return;
    const editorRect = editor.getBoundingClientRect();
    editor.style.setProperty(
      "--form-editor-left",
      `${Math.max(12, editorRect.left)}px`,
    );
    editor.style.setProperty(
      "--form-editor-right",
      `${Math.max(12, window.innerWidth - editorRect.right)}px`,
    );
    editor.style.setProperty(
      "--form-review-height",
      `${review.value?.getBoundingClientRect().height || 0}px`,
    );
  }
  function reveal() {
    frame = 0;
    if (!listening || !root.value) return;
    const nav = document.querySelector<HTMLElement>(".app-mobile-nav");
    const navRect = nav?.getBoundingClientRect();
    const field = document.activeElement;
    if (
      !(field instanceof HTMLElement) ||
      !root.value.contains(field) ||
      review.value?.contains(field)
    )
      return;
    if (topChrome?.value?.contains(field) && field.matches("h1, h2")) {
      const chromeRect = field.getBoundingClientRect();
      if (
        chromeRect.top >= 0 &&
        chromeRect.bottom <= (viewport?.height ?? window.innerHeight)
      )
        return;
    }
    const rect = field.getBoundingClientRect();
    const reviewRect = review.value?.getBoundingClientRect();
    const obstructions: DOMRect[] = [];
    if (navRect) obstructions.push(navRect);
    if (fixedReview() && reviewRect) obstructions.push(reviewRect);
    for (const action of Array.from(
      document.querySelectorAll<HTMLElement>(
        ".current-fab > button, .return-top",
      ),
    )) {
      if (action === field || !action.getClientRects().length) continue;
      const actionRect = action.getBoundingClientRect();
      obstructions.push(actionRect);
    }
    const owner = scrollOwner(field);
    if (topChrome?.value && !topChrome.value.contains(field))
      obstructions.push(topChrome.value.getBoundingClientRect());
    const obstruction = obstructions.find(
      (edge) =>
        rect.right > edge.left &&
        rect.left < edge.right &&
        rect.bottom > edge.top &&
        rect.top < edge.bottom,
    );
    if (!obstruction) return;
    const topCover = obstruction.bottom - rect.top;
    const bottomCover = rect.bottom - obstruction.top;
    // Safari handles viewport reveal. Move only when fixed chrome overlaps the field.
    scrollBy(owner, topCover < bottomCover ? -topCover - 12 : bottomCover + 12);
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
    window.removeEventListener("resize", syncLayoutVariables);
    window.removeEventListener("inventory-text-scale", schedule);
    window.removeEventListener("inventory-text-scale", syncLayoutVariables);
    viewport?.removeEventListener("resize", schedule);
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
    viewport = window.visualViewport;
    root.value.addEventListener("focusin", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("resize", syncLayoutVariables);
    viewport?.addEventListener("resize", schedule);
    window.addEventListener("inventory-text-scale", schedule);
    window.addEventListener("inventory-text-scale", syncLayoutVariables);
    syncLayoutVariables();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(root.value);
      if (review.value) observer.observe(review.value);
      if (topChrome?.value) observer.observe(topChrome.value);
      const nav = document.querySelector(".app-mobile-nav");
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
