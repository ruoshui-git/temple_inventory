import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  type Ref,
} from "vue";

/** The part of a table entry the sticky path needs: groups carry a depth, records do not. */
export interface StickyGroupMeta {
  kind: "group" | "record";
  depth?: number;
}

/**
 * The group path above a table position: for each depth, the nearest group above `anchorIndex`
 * that belongs to the previous group on the path. Returns indices, shallowest first. The anchor is
 * the first row whose top is still below the sticky line, so it is never part of the path itself.
 */
export function stickyGroupPath(
  rows: readonly StickyGroupMeta[],
  anchorIndex: number,
): number[] {
  const path: number[] = [];
  const start = Math.min(anchorIndex, rows.length) - 1;
  let lower = -1;
  for (let depth = 1; ; depth++) {
    let found = -1;
    for (let index = start; index > lower; index--) {
      const row = rows[index]!;
      if (row.kind !== "group") continue;
      const rowDepth = row.depth ?? 1;
      // A shallower group ends the section this depth belongs to.
      if (rowDepth < depth) break;
      if (rowDepth === depth) {
        found = index;
        break;
      }
    }
    if (found < 0) return path;
    path.push(found);
    lower = found;
  }
}

/** The first row after `from` that starts a group of the same or a shallower depth. */
export function nextGroupIndex(
  rows: readonly StickyGroupMeta[],
  from: number,
  depth: number,
) {
  for (let index = from + 1; index < rows.length; index++) {
    const row = rows[index]!;
    if (row.kind === "group" && (row.depth ?? 1) <= depth) return index;
  }
  return -1;
}

/**
 * Sticky tops for the path rows, shallowest first, and the stack height. Rows stack below the sticky
 * line. A path row is pushed up when the next group of the same or shallower depth reaches the
 * bottom of its slot, so it slides away instead of being replaced abruptly.
 */
export function stickyStack(
  rows: readonly StickyGroupMeta[],
  path: readonly number[],
  heights: readonly number[],
  line: number,
  naturalTop: (index: number) => number | undefined,
) {
  let base = line;
  const tops = path.map((index, position) => {
    const slot = base;
    base += heights[position] ?? 0;
    const next = nextGroupIndex(rows, index, rows[index]?.depth ?? 1);
    const nextTop = next < 0 ? undefined : naturalTop(next);
    return nextTop === undefined
      ? slot
      : Math.min(slot, nextTop - (heights[position] ?? 0));
  });
  return { tops, height: base - line };
}

/** Sticky group rows need the table box to be a vertical clip, not a vertical scroller. */
export function stickyRowsAllowed(overflowY: string) {
  return overflowY === "clip";
}

interface StickyRowsOptions {
  table: Ref<HTMLElement | undefined>;
  entries: () => readonly StickyGroupMeta[];
  rowElements: () => HTMLTableRowElement[];
  enabled: () => boolean;
}

const STUCK_CLASS = "is-stuck";
const DEEPER_CLASS = "is-stuck-deeper";
const LAST_CLASS = "is-stuck-last";
const STUCK_OFFSET = "--stuck-offset";
const STACK_HEIGHT = "--data-table-stuck-height";

function setVariable(
  element: HTMLElement,
  name: string,
  value: string | undefined,
) {
  if (value === undefined) {
    if (element.style.getPropertyValue(name))
      element.style.removeProperty(name);
    return;
  }
  if (element.style.getPropertyValue(name) !== value)
    element.style.setProperty(name, value);
}
function setFlag(element: HTMLElement, name: string, on: boolean) {
  if (element.classList.contains(name) !== on)
    element.classList.toggle(name, on);
}

/**
 * Keeps the current group path of a grouped table stuck under the column header. Listeners run only
 * while the table is mounted, active and enabled; the DOM changes only when a stuck state changes.
 */
export function useStickyGroupRows(options: StickyRowsOptions) {
  let listening = false;
  let frame = 0;

  // The row's position without its sticky offset: offsetTop ignores sticky, so stuck rows keep
  // their place in the scan.
  function naturalTop(row: HTMLElement) {
    const parent = row.offsetParent as HTMLElement | null;
    if (!parent) return undefined;
    return (
      parent.getBoundingClientRect().top + parent.clientTop + row.offsetTop
    );
  }

  function clear() {
    const table = options.table.value;
    if (!table) return;
    table.querySelectorAll<HTMLElement>("tr.is-stuck").forEach((row) => {
      row.classList.remove(STUCK_CLASS, DEEPER_CLASS, LAST_CLASS);
      row.style.removeProperty(STUCK_OFFSET);
    });
    table.style.removeProperty(STACK_HEIGHT);
  }

  function apply(
    rows: HTMLTableRowElement[],
    path: number[],
    tops: number[],
    line: number,
    height: number,
  ) {
    const table = options.table.value!;
    const meta = options.entries();
    const pathRows = new Set(path.map((index) => rows[index]!));
    table.querySelectorAll<HTMLElement>("tr.is-stuck").forEach((row) => {
      if (pathRows.has(row as HTMLTableRowElement)) return;
      row.classList.remove(STUCK_CLASS, DEEPER_CLASS, LAST_CLASS);
      row.style.removeProperty(STUCK_OFFSET);
    });
    path.forEach((index, position) => {
      const row = rows[index]!;
      setFlag(row, STUCK_CLASS, true);
      setFlag(row, DEEPER_CLASS, (meta[index]?.depth ?? 1) > 1);
      setFlag(row, LAST_CLASS, position === path.length - 1);
      // CSS adds this to the header's own offset, so stuck rows follow the header with no measuring
      // when the toolbar condenses.
      setVariable(row, STUCK_OFFSET, `${tops[position]! - line}px`);
    });
    setVariable(table, STACK_HEIGHT, path.length ? `${height}px` : undefined);
  }

  function measure() {
    const table = options.table.value;
    if (!table || !table.offsetParent) return;
    const rows = options.rowElements();
    const meta = options.entries();
    if (
      !options.enabled() ||
      !meta.some((row) => row.kind === "group") ||
      rows.length !== meta.length ||
      !stickyRowsAllowed(getComputedStyle(table).overflowY)
    ) {
      clear();
      return;
    }
    const box = table.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= window.innerHeight) return;
    const header = table.querySelector<HTMLElement>("thead th");
    const headerTop = header
      ? Number.parseFloat(getComputedStyle(header).top)
      : Number.NaN;
    if (!Number.isFinite(headerTop)) {
      clear();
      return;
    }
    const headerHeight = table
      .querySelector("thead")!
      .getBoundingClientRect().height;
    const line = headerTop + headerHeight;
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const top = naturalTop(rows[middle]!);
      if (top !== undefined && top < line) low = middle + 1;
      else high = middle;
    }
    const path = stickyGroupPath(meta, low);
    const heights = path.map(
      (index) => rows[index]!.getBoundingClientRect().height,
    );
    const stack = stickyStack(meta, path, heights, line, (index) =>
      naturalTop(rows[index]!),
    );
    apply(rows, path, stack.tops, line, stack.height);
  }

  function refresh() {
    if (!listening || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (listening) measure();
    });
  }

  function stop() {
    listening = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener("scroll", refresh, true);
    window.removeEventListener("resize", refresh);
    clear();
  }

  function start() {
    stop();
    if (!options.enabled() || !options.table.value?.isConnected) return;
    listening = true;
    window.addEventListener("scroll", refresh, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", refresh);
    refresh();
  }

  function rowById(id: string, stuckOnly: boolean) {
    const table = options.table.value;
    if (!table) return undefined;
    const selector = stuckOnly ? "tr.is-stuck" : "tr";
    return Array.from(table.querySelectorAll<HTMLElement>(selector)).find(
      (row) => row.dataset.rowId === id,
    );
  }

  /**
   * Before a stuck group toggles, returns a callback that keeps its row where it is on screen after
   * the toggle. Undefined when the row is not stuck, so ordinary toggles scroll nothing.
   */
  function placeOf(id: string) {
    const cell = rowById(id, true)?.querySelector("td");
    if (!cell) return undefined;
    const target = cell.getBoundingClientRect().top;
    return () => {
      const current = rowById(id, false);
      if (!current) return;
      const delta = current.getBoundingClientRect().top - target;
      if (Math.abs(delta) > 1)
        window.scrollBy({ top: delta, behavior: "instant" });
      refresh();
    };
  }

  onMounted(start);
  onActivated(start);
  onDeactivated(stop);
  onBeforeUnmount(stop);

  return { refresh, placeOf };
}
