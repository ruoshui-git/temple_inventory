import { shallowRef } from "vue";

export interface LocationLevel {
  code: string;
  name: string;
}
export type LocationTooltip = {
  location: { path: string; levels: LocationLevel[] };
};
type TooltipContent =
  string | { text: string; overflow?: boolean } | LocationTooltip;
export type TooltipValue = TooltipContent | false | null | undefined | 0;

type Trigger = { value: TooltipContent; overflow: boolean };
type Mode = "hover" | "focus" | "touch";
type ActiveTooltip = {
  anchor: HTMLElement;
  described: HTMLElement;
  value: TooltipContent;
  mode: Mode;
};
type TouchGesture = {
  anchor: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  opened: boolean;
};

export const tooltipId = "inventory-tooltip";
export const activeTooltip = shallowRef<ActiveTooltip>();
const triggers = new WeakMap<HTMLElement, Trigger>();
let pending: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastClosed = -Infinity;
let gesture: TouchGesture | undefined;
let suppressClick: HTMLElement | undefined;
let pointerFocus = false;
let observer: MutationObserver | undefined;

function triggerAt(target: EventTarget | null): HTMLElement | undefined {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (element instanceof HTMLElement && triggers.has(element)) return element;
    element = element.parentElement;
  }
}

function onHost(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("#" + tooltipId));
}

function tooltipAnchorUsable(anchor: HTMLElement): boolean {
  if (!anchor.isConnected) return false;
  for (
    let element: HTMLElement | null = anchor;
    element;
    element = element.parentElement
  ) {
    if (element.inert || element.hidden || element.style.display === "none")
      return false;
  }
  return true;
}

function clipped(anchor: HTMLElement): boolean {
  const { overflowX, overflowY } = getComputedStyle(anchor);
  return (
    (overflowX !== "visible" && anchor.scrollWidth > anchor.clientWidth) ||
    (overflowY !== "visible" && anchor.scrollHeight > anchor.clientHeight)
  );
}

function cancelPending() {
  clearTimeout(timer);
  timer = undefined;
  pending = undefined;
}

function schedule(anchor: HTMLElement, delay: number, callback: () => void) {
  cancelPending();
  pending = anchor;
  timer = setTimeout(() => {
    cancelPending();
    callback();
  }, delay);
}

export function tooltipText(value: TooltipContent): string {
  if (typeof value === "string") return value;
  if ("text" in value) return value.text;
  const { path, levels } = value.location;
  return [
    path,
    ...levels.map(({ code, name }) => [code, name].filter(Boolean).join(" ")),
  ].join(" ");
}

function accessibleName(element: HTMLElement): string {
  const labels = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(" ");
  const nativeLabels =
    "labels" in element
      ? Array.from(
          (element as HTMLInputElement).labels || [],
          (label) => label.textContent,
        ).join(" ")
      : "";
  return (
    labels ||
    element.getAttribute("aria-label") ||
    nativeLabels ||
    element.textContent ||
    ""
  );
}

function describe({ described, value }: ActiveTooltip, add: boolean) {
  const ids = (described.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter(Boolean);
  const sameName =
    add &&
    tooltipText(value).trim().replace(/\s+/g, " ") ===
      accessibleName(described).trim().replace(/\s+/g, " ");
  const next =
    add && !sameName
      ? ids.includes(tooltipId)
        ? ids
        : [...ids, tooltipId]
      : ids.filter((id) => id !== tooltipId);
  if (ids.join(" ") === next.join(" ")) return;
  if (next.length) described.setAttribute("aria-describedby", next.join(" "));
  else described.removeAttribute("aria-describedby");
}

export function dismissTooltip() {
  cancelPending();
  gesture = undefined;
  const active = activeTooltip.value;
  if (!active) return;
  observer?.disconnect();
  describe(active, false);
  activeTooltip.value = undefined;
  lastClosed = Date.now();
}

export function setTooltip(
  anchor: HTMLElement,
  value: TooltipValue,
  overflow: boolean,
) {
  if (!value || !tooltipText(value).trim()) {
    removeTooltip(anchor);
    return;
  }
  if (!triggers.has(anchor)) anchor.setAttribute("data-inventory-tip", "");
  const valueOverflow =
    typeof value === "object" && "text" in value && value.overflow === true;
  triggers.set(anchor, { value, overflow: overflow || valueOverflow });
  const active = activeTooltip.value;
  if (active?.anchor === anchor) show(anchor, active.mode, active.described);
}

export function removeTooltip(anchor: HTMLElement) {
  if (!triggers.delete(anchor)) return;
  anchor.removeAttribute("data-inventory-tip");
  if (suppressClick === anchor) suppressClick = undefined;
  if (anchor === activeTooltip.value?.anchor || anchor === pending)
    dismissTooltip();
}

export function tooltipValueFor(anchor: HTMLElement): TooltipValue {
  return triggers.get(anchor)?.value;
}

function show(anchor: HTMLElement, mode: Mode, described = anchor): boolean {
  const trigger = triggers.get(anchor);
  if (
    !trigger ||
    !tooltipAnchorUsable(anchor) ||
    (trigger.overflow && !clipped(anchor))
  ) {
    if (activeTooltip.value?.anchor === anchor) dismissTooltip();
    return false;
  }
  cancelPending();
  const old = activeTooltip.value;
  if (old) describe(old, false);
  const next = { anchor, described, value: trigger.value, mode };
  activeTooltip.value = next;
  describe(next, true);
  observer?.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["inert", "hidden", "style", "aria-describedby"],
  });
  return true;
}

function pointerOver(event: PointerEvent) {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
  if (onHost(event.target)) {
    if (activeTooltip.value) cancelPending();
    return;
  }
  const anchor = triggerAt(event.target);
  if (!anchor) return;
  const active = activeTooltip.value;
  if (active?.anchor === anchor) {
    cancelPending();
    return;
  }
  if (anchor === pending) return;
  if (active || Date.now() - lastClosed < 300) show(anchor, "hover");
  else schedule(anchor, 120, () => show(anchor, "hover"));
}

function pointerOut(event: PointerEvent) {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
  const anchor = triggerAt(event.target);
  const next = triggerAt(event.relatedTarget);
  const active = activeTooltip.value;
  if (anchor && anchor === next) return;
  if (!active) {
    if (anchor && anchor === pending) cancelPending();
    return;
  }
  if (
    active.mode !== "hover" ||
    (anchor !== active.anchor && !onHost(event.target))
  )
    return;
  if (next === active.anchor || onHost(event.relatedTarget)) return;
  schedule(active.anchor, 100, dismissTooltip);
}

function focusIn(event: FocusEvent) {
  const target = event.target;
  if (
    pointerFocus ||
    !(target instanceof HTMLElement) ||
    !target.matches(":focus-visible")
  )
    return;
  const anchor = triggerAt(target);
  if (anchor) show(anchor, "focus", target);
}

function focusOut(event: FocusEvent) {
  if (
    activeTooltip.value?.mode === "focus" &&
    activeTooltip.value.described === event.target
  )
    dismissTooltip();
}

function keyDown(event: KeyboardEvent) {
  pointerFocus = false;
  if (event.key !== "Escape") return;
  const active = activeTooltip.value;
  const wasOpen = active && tooltipAnchorUsable(active.anchor);
  dismissTooltip();
  if (wasOpen) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function pointerDown(event: PointerEvent) {
  pointerFocus = true;
  suppressClick = undefined;
  dismissTooltip();
  if (event.pointerType !== "touch" || event.isPrimary === false) return;
  const anchor = triggerAt(event.target);
  if (!anchor) return;
  const touch = {
    anchor,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    opened: false,
  };
  gesture = touch;
  schedule(anchor, 450, () => {
    if (gesture !== touch) return;
    touch.opened = show(anchor, "touch");
    if (touch.opened) suppressClick = anchor;
  });
}

function pointerMove(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8)
    dismissTooltip();
}

function pointerEnd(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (event.type === "pointercancel" || !gesture.opened) dismissTooltip();
  gesture = undefined;
}

function click(event: MouseEvent) {
  if (!suppressClick || !event.detail) return;
  const anchor = suppressClick;
  suppressClick = undefined;
  if (!(event.target instanceof Node) || !anchor.contains(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function contextMenu(event: MouseEvent) {
  if (
    gesture &&
    event.target instanceof Node &&
    gesture.anchor.contains(event.target)
  ) {
    event.preventDefault();
  }
}

function scroll(event: Event) {
  if (!onHost(event.target)) dismissTooltip();
}

export function dismissIfTooltipIsUnusable() {
  const active = activeTooltip.value;
  if (!active) return;
  const trigger = triggers.get(active.anchor);
  if (
    !tooltipAnchorUsable(active.anchor) ||
    (trigger?.overflow && !clipped(active.anchor))
  )
    dismissTooltip();
}

export function listenForTooltips(): () => void {
  const controller = new AbortController();
  const capture = { capture: true, signal: controller.signal };
  observer = new MutationObserver(() => {
    const active = activeTooltip.value;
    if (!active) return;
    if (!tooltipAnchorUsable(active.anchor) || !active.described.isConnected)
      dismissTooltip();
    else describe(active, true);
  });
  document.addEventListener("pointerover", pointerOver, capture);
  document.addEventListener("pointerout", pointerOut, capture);
  document.addEventListener("focusin", focusIn, capture);
  document.addEventListener("focusout", focusOut, capture);
  document.addEventListener("keydown", keyDown, capture);
  document.addEventListener("pointerdown", pointerDown, capture);
  document.addEventListener("pointermove", pointerMove, capture);
  document.addEventListener("pointerup", pointerEnd, capture);
  document.addEventListener("pointercancel", pointerEnd, capture);
  document.addEventListener("click", click, capture);
  document.addEventListener("contextmenu", contextMenu, capture);
  window.addEventListener("scroll", scroll, capture);
  window.visualViewport?.addEventListener("scroll", scroll, capture);
  window.addEventListener("blur", dismissTooltip, {
    signal: controller.signal,
  });
  window.addEventListener("popstate", dismissTooltip, capture);
  window.addEventListener("hashchange", dismissTooltip, capture);
  document.addEventListener("inventory-navigation", dismissTooltip, capture);
  return () => {
    controller.abort();
    dismissTooltip();
    observer?.disconnect();
    observer = undefined;
    lastClosed = -Infinity;
    suppressClick = undefined;
    pointerFocus = false;
  };
}
