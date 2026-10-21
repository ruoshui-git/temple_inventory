import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { useItemPicker } from "../src/features/items/useItemPicker";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

it("sends multi-category subtree selections and the independent uncategorized scope", async () => {
  let picker!: ReturnType<typeof useItemPicker>;
  const pickerProps = reactive({ timestamp: "2026-10-21 09:30:00" });
  const reference = createReferenceData();
  reference.user = "volunteer";
  reference.site = "unit-site";
  reference.categories = [
    { name: "FOOD", label: "食品", parent: "", is_group: true, lft: 1, rgt: 4 },
    {
      name: "COSTUMES",
      label: "服装",
      parent: "",
      is_group: true,
      lft: 5,
      rgt: 8,
    },
  ];
  const call = vi.fn<InventoryServices["call"]>(async (endpoint) =>
    endpoint === "catalog.operation_item"
      ? ({ item_code: "ITEM-A", item_name: "测试物品", stock: [] } as never)
      : ({ results: [], matched_count: 0, next_start: null } as never),
  );
  const child = defineComponent({
    setup() {
      picker = useItemPicker(pickerProps, vi.fn());
      return () => h("div");
    },
  });
  const host = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  wrappers.push(mount(host));
  await flushPromises();
  picker.categoryFilters.value = ["FOOD", "COSTUMES"];
  picker.uncategorizedFilter.value = true;
  picker.warehouseFilters.value = ["WAREHOUSE-A", "WAREHOUSE-B"];
  await flushPromises();
  const args = call.mock.calls.at(-1)?.[1];
  expect(args).toMatchObject({
    categories: ["FOOD", "COSTUMES"],
    uncategorized: true,
    warehouses: ["WAREHOUSE-A", "WAREHOUSE-B"],
    timestamp: "2026-10-21 09:30:00",
  });
  window.dispatchEvent(
    new CustomEvent("inventory-category-renamed", {
      detail: {
        oldName: "FOOD",
        category: { name: "FOOD-RENAMED", label: "食品新名" },
      },
    }),
  );
  await flushPromises();
  expect(picker.categoryFilters.value).toEqual(["FOOD-RENAMED", "COSTUMES"]);
  expect(call.mock.calls.at(-1)?.[1]).toMatchObject({
    categories: ["FOOD-RENAMED", "COSTUMES"],
    uncategorized: true,
    warehouses: ["WAREHOUSE-A", "WAREHOUSE-B"],
  });
  await picker.showDetail("ITEM-A");
  expect(call).toHaveBeenCalledWith(
    "catalog.operation_item",
    { item_code: "ITEM-A", timestamp: "2026-10-21 09:30:00" },
    expect.any(AbortSignal),
  );
});
