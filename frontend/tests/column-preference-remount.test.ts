// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { useColumnPreferences } from "../src/composables/useColumnPreferences";
import { createReferenceData } from "../src/services/contracts";
import type { DataColumn } from "../src/lib/dataTable";

// Mirrors the damaged page: the table id and the column schema both come from the
// report table, which is absent on the first render and arrives in the same flush.
const pageColumns: DataColumn[] = [
  { id: "item_name", label: "物品名称", required: true },
  { id: "item_code", label: "物品编号" },
  { id: "batch_no", label: "批次编号" },
  { id: "warehouse_label", label: "库位", defaultVisible: false },
];

let wrappers: VueWrapper[] = [];
let serverStore: Map<string, unknown>;
// Module-level memory is shared by a file, so each test gets its own account scope.
let siteSequence = 0;

beforeEach(() => {
  window.localStorage.clear();
  serverStore = new Map();
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function serverCall() {
  return vi.fn(async (method: string, args: Record<string, unknown>) => {
    const tableId = String(args.table_id);
    if (method.endsWith("get_column_preferences"))
      return serverStore.get(tableId) ?? undefined;
    serverStore.set(tableId, args.preference);
    return args.preference;
  });
}

function mountPage(
  reference: ReturnType<typeof createReferenceData>,
  call: ReturnType<typeof serverCall>,
  initialTable?: { id: string },
) {
  const table = ref<{ id: string } | undefined>(initialTable);
  const tableId = computed(
    () => `pending.inventory.damaged.${table.value?.id || ""}`,
  );
  const columns = computed(() => (table.value ? pageColumns : []));
  let controller!: ReturnType<typeof useColumnPreferences>;
  const root = defineComponent({
    setup() {
      controller = useColumnPreferences(tableId, columns, reference, {
        call,
        report: vi.fn(),
        upload: vi.fn(),
      } as never);
      return () => h("div");
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { wrapper, table, controller: () => controller };
}

describe("column preferences across a page remount", () => {
  it("keeps a hidden column hidden after the table loads late and the page remounts", async () => {
    vi.useFakeTimers();
    const reference = createReferenceData();
    Object.assign(reference, {
      site: `race-${++siteSequence}.local`,
      user: "race-user",
    });
    const call = serverCall();

    // First mount: the report table is still loading.
    const first = mountPage(reference, call);
    await flushPromises();
    // The table arrives: tableId and columns change in one flush.
    first.table.value = { id: "T1" };
    await nextTick();
    await flushPromises();
    expect(first.controller().visible.value).toContain("batch_no");

    first.controller().toggle("batch_no");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(serverStore.get("pending.inventory.damaged.T1")).toEqual({
      order: ["item_name", "item_code", "batch_no", "warehouse_label"],
      hidden: ["batch_no", "warehouse_label"],
    });

    first.wrapper.unmount();
    wrappers = wrappers.filter((wrapper) => wrapper !== first.wrapper);

    // Remount with the table already present (the page keeps its report).
    const second = mountPage(reference, call, { id: "T1" });
    await flushPromises();
    expect(second.controller().visible.value).not.toContain("batch_no");
  });

  it("keeps the hide when the page remounts while the table is still loading", async () => {
    vi.useFakeTimers();
    const reference = createReferenceData();
    Object.assign(reference, {
      site: `race-${++siteSequence}.local`,
      user: "race-user",
    });
    const call = serverCall();

    const first = mountPage(reference, call, { id: "T1" });
    await flushPromises();
    first.controller().toggle("batch_no");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    first.wrapper.unmount();
    wrappers = wrappers.filter((wrapper) => wrapper !== first.wrapper);

    // Remount before the report table has loaded: schema is empty at setup.
    const second = mountPage(reference, call);
    await flushPromises();
    second.table.value = { id: "T1" };
    await nextTick();
    await flushPromises();
    expect(second.controller().visible.value).not.toContain("batch_no");
    expect(serverStore.get("pending.inventory.damaged.T1")).toEqual({
      order: ["item_name", "item_code", "batch_no", "warehouse_label"],
      hidden: ["batch_no", "warehouse_label"],
    });
  });
});
