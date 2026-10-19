import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import {
  useBatchDetailController,
  type BatchDetail,
} from "../src/features/batches/useBatchDetailController";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function detail(name: string): BatchDetail {
  return {
    name,
    item_code: "ITEM-A",
    item: { item_code: "ITEM-A", item_name: "物品甲", image: "" },
    manufacturing_date: "2026-01-01",
    expiry_date: "2027-01-01",
    description: "资料",
    disabled: false,
    version: "v1",
    can_edit: true,
    locations: {
      rows: [{ id: `${name}-L`, stock_uom: "Nos", stock_qty: 2, available: 2 }],
      matched_count: 1,
      next_start: null,
      summary: [{ stock_uom: "Nos", stock_qty: 2, available: 2 }],
    },
    history: {
      rows: [{ id: `${name}-H`, document: "DOC-1" }],
      matched_count: 2,
      next_start: 20,
    },
  };
}
function setup(call: InventoryServices["call"], initialName = "BATCH-A") {
  const name = ref(initialName),
    reference = createReferenceData();
  Object.assign(reference, { user: "account-a", site: "unit-site" });
  let controller!: ReturnType<typeof useBatchDetailController>;
  const child = defineComponent({
    setup() {
      controller = useBatchDetailController({ name });
      return () => h("div");
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { controller, reference, name, wrapper };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("batch detail controller", () => {
  it("discards stale route/account responses and clears a denied batch", async () => {
    const first = deferred<BatchDetail>();
    const call = vi.fn(
      async (_endpoint: string, args?: Record<string, unknown>) =>
        args?.name === "BATCH-A" ? first.promise : detail(String(args?.name)),
    );
    const { controller, name, reference } = setup(
      call as InventoryServices["call"],
    );
    await flushPromises();
    name.value = "BATCH-B";
    await flushPromises();
    expect(controller.batch.value?.name).toBe("BATCH-B");
    first.resolve(detail("BATCH-A"));
    await flushPromises();
    expect(controller.batch.value?.name).toBe("BATCH-B");
    call.mockImplementation(async (endpoint, args) =>
      endpoint === "catalog.batch_details" && args?.name === "BATCH-C"
        ? Promise.reject(new Error("无权访问"))
        : detail(String(args?.name)),
    );
    name.value = "BATCH-C";
    await flushPromises();
    expect(controller.batch.value).toBeUndefined();
    expect(controller.error.value).toContain("无权访问");
    reference.user = "account-b";
    await flushPromises();
    expect(controller.batch.value).toBeUndefined();
  });
  it("preserves unsaved metadata after a stale-version save failure", async () => {
    const call = vi.fn(async (endpoint: string) =>
      endpoint === "catalog.batch_details"
        ? detail("BATCH-A")
        : Promise.reject(new Error("记录已被其他人修改")),
    );
    const { controller } = setup(call as InventoryServices["call"]);
    await flushPromises();
    controller.beginEdit();
    controller.description.value = "本地修改";
    await controller.save();
    expect(controller.description.value).toBe("本地修改");
    expect(controller.editing.value).toBe(true);
    expect(controller.error.value).toContain("其他人修改");
  });
  it("retries paged history, deduplicates rows, and appends location pages", async () => {
    let historyAttempt = 0;
    const call = vi.fn(
      async (endpoint: string, args?: Record<string, unknown>) => {
        if (endpoint === "catalog.batch_details") return detail("BATCH-A");
        if (endpoint === "catalog.batch_history" && historyAttempt++ === 0)
          throw new Error("暂时不可用");
        if (endpoint === "catalog.batch_history")
          return {
            rows: [{ id: "BATCH-A-H" }, { id: "H-2" }],
            matched_count: 2,
            next_start: null,
          };
        return {
          rows: [{ id: "L-2", stock_qty: 0 }],
          matched_count: 2,
          next_start: null,
          summary: [{ stock_uom: "Nos", stock_qty: 2, available: 2 }],
        };
      },
    );
    const { controller } = setup(call as InventoryServices["call"]);
    await flushPromises();
    await controller.moreHistory();
    expect(controller.historyError.value).toContain("暂时不可用");
    await controller.moreHistory();
    expect(controller.batch.value?.history.rows.map((row) => row.id)).toEqual([
      "BATCH-A-H",
      "H-2",
    ]);
    controller.batch.value!.locations.next_start = 1;
    await controller.moreLocations();
    expect(controller.batch.value?.locations.rows).toHaveLength(2);
    expect(controller.batch.value?.locations.rows[1]?.stock_qty).toBe(0);
  });
});
