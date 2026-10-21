/** Tab-local UI state and page depth. Native result rows are always read again. */
import {
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  watch,
  type InjectionKey,
} from "vue";
import { getCurrentInstance } from "vue";
import type { InventoryServices } from "../services/contracts";
import { scrollOwner } from "../composables/scrollSurface";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";

interface ScrollSnapshot {
  top: number;
  left: number;
  anchors: { id: string; offset: number }[];
  details: { key: string; open: boolean }[];
  nested: { key: string; top: number; left: number }[];
  focus?: { row: string; index: number };
}
interface UISnapshot {
  scope: string;
  values: Record<string, unknown>;
  scroll?: ScrollSnapshot;
}
interface Entry {
  ui: Map<string, UISnapshot>;
  depth: Map<string, number>;
  restore: Set<string>;
}
const pagedReads = new Set([
  "browse.inventory_page",
  "browse.operation_page",
  "browse.operation_contributions",
  "browse.operation_analysis",
  "browse.expiry_page",
  "browse.expiry_analysis",
  "browse.native_drafts",
  "browse.counts_page",
]);
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface PagedResult {
  rows: unknown[];
  next_start: number | null;
  matched_count: number;
  [field: string]: unknown;
}
export function createBrowseMemory(context: () => string) {
  const entries = new Map<string, Entry>();
  let active = "";
  function activate(key = context()) {
    if (key === active) return;
    active = key;
    let entry = entries.get(key);
    if (!entry) entry = { ui: new Map(), depth: new Map(), restore: new Set() };
    else entry.restore = new Set(entry.depth.keys());
    entries.delete(key);
    entries.set(key, entry);
    // UI metadata is bounded; this contains no native quantities or File bytes.
    while (entries.size > 80) entries.delete(entries.keys().next().value!);
  }
  function capture() {
    activate();
    return entries.get(active)!;
  }
  async function read<T>(
    endpoint: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    fetch: (args: Record<string, unknown>) => Promise<T>,
  ): Promise<T> {
    const entry = capture(),
      { start: _start, page_length: _length, ...scope } = args;
    const key = endpoint + ":" + stable(scope),
      start = Number(args.start || 0);
    let response: T = await fetch(args);
    if (signal?.aborted) return response;
    const page = response as PagedResult;
    if (!Array.isArray(page?.rows)) return response;
    // The first report request omits table; later pages name it explicitly.
    // Both must restore the same depth when the main table is revisited.
    const tableKey =
      endpoint === "report" && page.table
        ? endpoint + ":" + stable({ ...scope, table: page.table })
        : key;
    const desired =
      start === 0 && (entry.restore.has(key) || entry.restore.has(tableKey))
        ? Math.max(entry.depth.get(key) || 0, entry.depth.get(tableKey) || 0)
        : 0;
    const rows = [...page.rows];
    let cursor = page.next_start;
    while (
      start === 0 &&
      rows.length < desired &&
      cursor !== null &&
      rows.length
    ) {
      const more = (await fetch({ ...args, start: cursor })) as PagedResult;
      if (signal?.aborted) return response;
      if (more.matched_count !== page.matched_count)
        throw new Error("浏览期间结果已变化，请重试当前范围");
      rows.push(...more.rows);
      if (!more.rows.length || more.next_start === cursor) break;
      cursor = more.next_start;
    }
    if (rows.length !== page.rows.length)
      response = { ...page, rows, next_start: cursor } as T;
    for (const identity of new Set([key, tableKey])) {
      entry.depth.set(
        identity,
        Math.max(start + rows.length, entry.depth.get(identity) || 0),
      );
      entry.restore.delete(identity);
    }
    while (entry.depth.size > 128)
      entry.depth.delete(entry.depth.keys().next().value!);
    return response;
  }
  function wrap(services: InventoryServices): InventoryServices {
    return {
      call: <T>(
        endpoint: string,
        args: Record<string, unknown> = {},
        signal?: AbortSignal,
      ) =>
        pagedReads.has(endpoint)
          ? read<T>(endpoint, args, signal, (next) =>
              services.call<T>(endpoint, next, signal),
            )
          : services.call<T>(endpoint, args, signal),
      report: (query, options = {}, signal) =>
        read("report", { query, ...options }, signal, (next) => {
          const { query: selected, ...page } = next;
          return services.report(selected as typeof query, page, signal);
        }),
      upload: services.upload,
    };
  }
  return { activate, capture, identity: () => active, wrap };
}
type BrowseMemory = ReturnType<typeof createBrowseMemory>;
const key: InjectionKey<BrowseMemory> = Symbol("browse-memory");
export function provideBrowseMemory(memory: BrowseMemory) {
  provide(key, memory);
}
export function useBrowseMemoryIdentity() {
  return inject(key, undefined)?.identity() || "";
}
function rootElement(instance: ReturnType<typeof getCurrentInstance>) {
  // A coordinator may render a conditional fragment around its single surface.
  let node: Node | null = instance?.proxy?.$el ?? null;
  while (node && node !== instance?.subTree.anchor) {
    if (node instanceof HTMLElement) return node;
    node = node.nextSibling;
  }
}
function edge(owner: Window | HTMLElement) {
  return owner === window
    ? 0
    : (owner as HTMLElement).getBoundingClientRect().top;
}
function position(owner: Window | HTMLElement) {
  return owner === window
    ? { top: window.scrollY, left: window.scrollX }
    : {
        top: (owner as HTMLElement).scrollTop,
        left: (owner as HTMLElement).scrollLeft,
      };
}
function move(owner: Window | HTMLElement, top: number, left: number) {
  if (owner === window) window.scrollTo({ top, left, behavior: "instant" });
  else {
    (owner as HTMLElement).scrollTop = top;
    (owner as HTMLElement).scrollLeft = left;
  }
}
function scrollSnapshot(root: HTMLElement): ScrollSnapshot {
  const owner = scrollOwner(root),
    rows = Array.from(root.querySelectorAll<HTMLElement>("[data-browse-row]"));
  const focused = document.activeElement as HTMLElement | null,
    focusedRow = focused?.closest<HTMLElement>("[data-browse-row]");
  const candidates =
    focusedRow && root.contains(focusedRow)
      ? [focusedRow, ...rows.filter((row) => row !== focusedRow)]
      : rows;
  const anchors = candidates
    .filter((row) => {
      const rect = row.getBoundingClientRect(),
        parent = scrollOwner(row);
      const bottom =
        edge(parent) +
        (parent === window
          ? window.innerHeight
          : (parent as HTMLElement).clientHeight);
      return rect.height > 0 && rect.bottom > edge(parent) && rect.top < bottom;
    })
    .slice(0, 6)
    .map((row) => ({
      id: row.dataset.browseRow!,
      offset: row.getBoundingClientRect().top - edge(scrollOwner(row)),
    }));
  const detailNodes = Array.from(
    root.querySelectorAll<HTMLDetailsElement>("details"),
  );
  const nested = Array.from(
    root.querySelectorAll<HTMLElement>("[data-browse-scroll]"),
  ).map((element) => ({
    key: element.dataset.browseScroll!,
    ...position(element),
  }));
  return {
    ...position(owner),
    anchors,
    nested,
    details: detailNodes.map((detail, index) => ({
      key: detail.dataset.browseDetails || String(index),
      open: detail.open,
    })),
    ...(focusedRow && root.contains(focusedRow)
      ? {
          focus: {
            row: focusedRow.dataset.browseRow!,
            index: Array.from(
              focusedRow.querySelectorAll("a,button,input,select,textarea"),
            ).indexOf(focused!),
          },
        }
      : {}),
  };
}
export function useBrowseState(
  namespace: string,
  scope: () => unknown,
  read: () => Record<string, unknown>,
  restore: (value: Record<string, unknown>) => void,
  ready: () => boolean,
) {
  const memory = inject(key, undefined);
  if (!memory) return { restored: false };
  const entry = memory.capture(),
    instance = getCurrentInstance(),
    previous = entry.ui.get(namespace);
  const restored = previous?.scope === stable(scope());
  if (restored) restore(copy(previous!.values));
  const { isDesktop } = useResponsiveLayout();
  let scroll = previous?.scroll;
  let lastScroll: ScrollSnapshot | undefined;
  let viewportWidth = 0,
    cacheFrame = 0,
    settled = 0,
    attempts = 0;
  let pending = restored && !!previous?.scroll,
    mounted = false,
    disposed = false,
    frame = 0,
    detailsApplied = false;
  const save = (withScroll = false) => {
    const element = rootElement(instance);
    entry.ui.set(namespace, {
      scope: stable(scope()),
      values: copy(read()),
      scroll:
        withScroll && element && !pending
          ? scrollSnapshot(element)
          : entry.ui.get(namespace)?.scroll,
    });
  };
  function intervene() {
    pending = false;
  }
  function rememberPosition() {
    // CSS media rules have already changed by the time a resize event arrives.
    // Preserve the last measured logical row from the prior viewport instead.
    if (
      !mounted ||
      disposed ||
      pending ||
      !ready() ||
      window.innerWidth !== viewportWidth
    )
      return;
    const root = rootElement(instance);
    if (root) lastScroll = scrollSnapshot(root);
    cancelAnimationFrame(cacheFrame);
    cacheFrame = requestAnimationFrame(() => {
      if (root && !disposed && !pending && window.innerWidth === viewportWidth)
        lastScroll = scrollSnapshot(root);
    });
  }
  async function attempt() {
    if (!pending || !mounted || disposed || !ready()) return;
    await nextTick();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!pending || disposed || !ready()) return;
      const root = rootElement(instance),
        saved = scroll;
      if (!root || !saved) return;
      if (!detailsApplied) {
        const details = Array.from(
          root.querySelectorAll<HTMLDetailsElement>("details"),
        );
        saved.details.forEach((value) => {
          const element = details.find(
            (detail, index) =>
              (detail.dataset.browseDetails || String(index)) === value.key,
          );
          if (element) element.open = value.open;
        });
        detailsApplied = true;
        void attempt();
        return;
      }
      const rows = Array.from(
        root.querySelectorAll<HTMLElement>("[data-browse-row]"),
      );
      const anchor = saved.anchors
        .map((value) => ({
          saved: value,
          element: rows.find((row) => row.dataset.browseRow === value.id),
        }))
        .find((value) => value.element);
      if (anchor?.element) {
        const owner = scrollOwner(anchor.element),
          current = position(owner);
        const difference =
          anchor.element.getBoundingClientRect().top -
          edge(owner) -
          anchor.saved.offset;
        settled = Math.abs(difference) < 1 ? settled + 1 : 0;
        move(owner, current.top + difference, current.left);
      } else {
        move(scrollOwner(root), saved.top, saved.left);
        settled++;
      }
      saved.nested.forEach((value) => {
        const element = Array.from(
          root.querySelectorAll<HTMLElement>("[data-browse-scroll]"),
        ).find((element) => element.dataset.browseScroll === value.key);
        if (element) {
          element.scrollLeft = value.left;
          if (!anchor) element.scrollTop = value.top;
        }
      });
      // A compact header can change height after our own scroll event. Allow
      // its reactive layout to settle before releasing this restoration.
      if (++attempts < 16 && settled < 3) {
        void attempt();
        return;
      }
      const focused =
        saved.focus &&
        rows
          .find((row) => row.dataset.browseRow === saved.focus!.row)
          ?.querySelectorAll<HTMLElement>("a,button,input,select,textarea")[
          saved.focus.index
        ];
      focused?.focus({ preventScroll: true });
      pending = false;
      rememberPosition();
    });
  }
  watch(
    () => stable([scope(), read()]),
    () => save(),
    { flush: "post" },
  );
  watch(
    isDesktop,
    () => {
      if (!mounted || pending) return;
      const root = rootElement(instance);
      if (!root) return;
      scroll = lastScroll || scrollSnapshot(root);
      viewportWidth = window.innerWidth;
      pending = true;
      detailsApplied = false;
      settled = attempts = 0;
      void attempt();
    },
    { flush: "pre" },
  );
  watch(
    ready,
    () => {
      void attempt();
    },
    { flush: "post" },
  );
  onMounted(() => {
    mounted = true;
    viewportWidth = window.innerWidth;
    const root = rootElement(instance);
    for (const event of ["pointerdown", "wheel", "touchstart", "keydown"])
      root?.addEventListener(event, intervene, { passive: true });
    root?.addEventListener("focusin", rememberPosition);
    window.addEventListener("scroll", rememberPosition, {
      capture: true,
      passive: true,
    });
    rememberPosition();
    void attempt();
  });
  onBeforeUnmount(() => {
    save(true);
    disposed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(cacheFrame);
    const root = rootElement(instance);
    for (const event of ["pointerdown", "wheel", "touchstart", "keydown"])
      root?.removeEventListener(event, intervene);
    root?.removeEventListener("focusin", rememberPosition);
    window.removeEventListener("scroll", rememberPosition, true);
  });
  return { restored };
}
