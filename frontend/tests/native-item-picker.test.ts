import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { useItemPicker } from "../src/features/items/useItemPicker";
import ItemPicker from "../src/features/items/ItemPicker.vue";
import { itemPickerColumns } from "../src/features/items/itemPickerColumns";
import {
  earliestBatchExpiry,
  showOnlyStockFilter,
} from "../src/features/documents/creationFormPresentation";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

it("keeps the picker image column and gives the item name the flexible track", () => {
  const columns = itemPickerColumns("可用库存", "outbound", true);
  const image = columns.find((column) => column.id === "image");
  const name = columns.find((column) => column.id === "name");
  expect(image).toMatchObject({
    label: "图片",
    minWidth: "56px",
    className: "picker-image-column",
  });
  expect(name).toMatchObject({
    minWidth: "180px",
    className: "picker-name-column",
  });
  expect(name).not.toHaveProperty("width");
  expect(columns.find((column) => column.id === "category")).toMatchObject({
    defaultVisible: false,
  });
  expect(columns.map((column) => column.id)).toEqual([
    "image",
    "name",
    "code",
    "category",
    "warehouse",
    "quantity",
  ]);
  expect(
    itemPickerColumns("目标库位现有", "inbound", true).map(
      (column) => column.id,
    ),
  ).toEqual(["image", "name", "code", "category", "quantity"]);
});

it("shows the earliest tracked batch expiry and stock-only picker purposes", () => {
  const expiry = earliestBatchExpiry({
    code: "A",
    name: "A",
    category: "",
    uom: "Nos",
    tracksBatch: true,
    tracksExpiry: true,
    available: 3,
    loaned: 0,
    damaged: 0,
    locations: [
      {
        location: "L",
        available: 3,
        loaned: 0,
        damaged: 0,
        batches: [
          { id: "later", available: 1, expiry: "2026-12-01" },
          { id: "early", available: 2, expiry: "2026-11-02" },
        ],
      },
    ],
  });
  expect(expiry).toBe("2026-11-02");
  expect(showOnlyStockFilter("outbound")).toBe(false);
  expect(showOnlyStockFilter("damaged")).toBe(false);
});

it("sends multi-category subtree selections and the independent uncategorized scope", async () => {
  let picker!: ReturnType<typeof useItemPicker>;
  const pickerProps = reactive({
    timestamp: "2026-10-21 09:30:00",
    purpose: "outbound" as "outbound" | "inbound",
    receivingWarehouse: "",
  });
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
      ? ({
          item_code: "ITEM-A",
          item_name: "测试物品",
          item_group: "",
          stock_uom: "Nos",
          description: "",
          version: "v1",
          has_batch_no: false,
          has_expiry_date: false,
          can_edit: true,
          barcodes: [],
          uoms: [],
          stock: [{ warehouse: "A", available: 2, stock_uom: "Nos" }],
        } as never)
      : ({ results: [], matched_count: 0, next_start: null } as never),
  );
  const remember = vi.fn();
  const child = defineComponent({
    setup() {
      picker = useItemPicker(pickerProps, remember);
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
  expect(remember).not.toHaveBeenCalled();
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
  pickerProps.purpose = "inbound";
  pickerProps.receivingWarehouse = "WAREHOUSE-B";
  await flushPromises();
  expect(call.mock.calls.at(-1)?.[1]).toMatchObject({
    purpose: "inbound",
    receiving_warehouse: "WAREHOUSE-B",
  });
  expect(call.mock.calls.at(-1)?.[1]).not.toHaveProperty("warehouses");
  await picker.ensureSelected("ITEM-A");
  expect(remember).toHaveBeenCalledWith(
    expect.objectContaining({
      locations: [expect.objectContaining({ location: "A", available: 2 })],
    }),
  );
  expect(call).toHaveBeenCalledWith("catalog.operation_item", {
    item_code: "ITEM-A",
    timestamp: "2026-10-21 09:30:00",
  });
});

it("shows inbound category-only filters and the receiving location stock header", async () => {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    warehouses: [
      {
        name: "ROOM-A",
        label: "演示室甲",
        path: "演示区 / 演示室甲",
        is_group: false,
        storable: true,
      },
    ],
  });
  const call = vi.fn<InventoryServices["call"]>(async (endpoint) => {
    if (endpoint === "catalog.picker_rows")
      return { results: [], matched_count: 0, next_start: null } as never;
    if (endpoint === "table_preferences.get_column_preferences")
      return {} as never;
    throw new Error(`Unexpected ${endpoint}`);
  });
  const Host = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () =>
        h(ItemPicker, {
          purpose: "inbound",
          receivingWarehouse: "ROOM-A",
        });
    },
  });
  const wrapper = mount(Host);
  wrappers.push(wrapper);
  await flushPromises();
  expect(call).toHaveBeenCalledWith(
    "table_preferences.get_column_preferences",
    {
      table_id: "item-picker.rows.v2",
    },
  );
  const pickerText = document.body.textContent || "";
  expect(pickerText).not.toContain("仓库 / 位置");
  expect(pickerText).not.toContain("仓库位置");
  expect(pickerText).toContain("演示室甲 现有");
});

it("drops a picker response from the previous account", async () => {
  let picker!: ReturnType<typeof useItemPicker>;
  const reference = createReferenceData();
  reference.user = "first-account";
  reference.site = "unit-site";
  let finishOld!: (value: unknown) => void;
  const call = vi.fn<InventoryServices["call"]>((endpoint) => {
    if (endpoint !== "catalog.picker_rows") return Promise.resolve({} as never);
    if (reference.user === "first-account")
      return new Promise((resolve) => {
        finishOld = resolve;
      }) as never;
    return Promise.resolve({
      results: [],
      matched_count: 0,
      next_start: null,
    } as never);
  });
  const props = reactive({ purpose: "outbound" as const });
  const child = defineComponent({
    setup() {
      picker = useItemPicker(props, vi.fn());
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
  reference.user = "second-account";
  await flushPromises();
  finishOld({
    results: [
      {
        item_code: "PRIVATE-ITEM",
        item_name: "Previous account item",
        item_group: "",
        stock_uom: "Nos",
        description: "",
        version: "v1",
        has_batch_no: false,
        has_expiry_date: false,
        can_edit: true,
        barcodes: [],
        uoms: [],
        stock: [],
        warehouse: "WAREHOUSE-A",
      },
    ],
    matched_count: 1,
    next_start: null,
  });
  await flushPromises();
  expect(picker.result.rows).toEqual([]);
  expect(picker.result.total).toBe(0);
});

it("continues the pending row selection once after discarding a dirty item draft", async () => {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    units: [{ name: "Nos", whole: true }],
    capabilities: { Item: { create: true } },
    warehouses: [
      {
        name: "ROOM-A",
        label: "样例库房 / Room A",
        parent: "",
        is_group: false,
      },
    ],
  });
  const item = {
    item_code: "ITEM-A",
    item_name: "Existing item",
    item_group: "",
    stock_uom: "Nos",
    image: "/private/files/item-a.jpg",
    description: "",
    version: "v1",
    has_batch_no: false,
    has_expiry_date: false,
    can_edit: true,
    barcodes: [],
    uoms: [],
    stock: [],
  };
  const call = vi.fn<InventoryServices["call"]>(async (endpoint) => {
    if (endpoint === "catalog.picker_rows")
      return {
        results: [
          {
            ...item,
            warehouse: "ROOM-A",
            warehouse_label: "T1 / Room A",
            picker_quantity: 2,
          },
        ],
        matched_count: 1,
        next_start: null,
      } as never;
    if (endpoint === "catalog.suggest_item_code")
      return { item_code: "ITEM-NEW" } as never;
    if (endpoint === "catalog.operation_item") return item as never;
    if (endpoint === "table_preferences.get_column_preferences")
      return {} as never;
    throw new Error(`Unexpected ${endpoint}`);
  });
  const selected = vi.fn();
  const Host = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(ItemPicker, { allowCreate: true, onSelect: selected });
    },
  });
  const wrapper = mount(Host);
  wrappers.push(wrapper);
  await flushPromises();
  const thumbnail = document.querySelector<HTMLButtonElement>(
    ".picker-image-cell .item-image-button",
  );
  expect(thumbnail?.style.width).toBe("44px");
  expect(thumbnail?.style.height).toBe("44px");
  const click = async (label: string) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes(label),
    );
    if (!button) throw new Error(`Missing button ${label}`);
    button.click();
    await flushPromises();
  };

  await click("新建物品");
  const nameInput = document.querySelector<HTMLInputElement>("input[required]");
  if (!nameInput) throw new Error("Missing Item name input");
  nameInput.value = "Unsaved draft";
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  await click("返回选择物品");
  await click("选择");
  expect(document.body.textContent).toContain("放弃未保存的物品");
  await click("放弃填写");

  expect(selected).toHaveBeenCalledTimes(1);
  expect(selected).toHaveBeenCalledWith({
    code: "ITEM-A",
    warehouse: "ROOM-A",
  });
  expect(document.body.textContent).not.toContain("放弃未保存的物品");
});

it("keeps a newly created item pinned in a fixed compact preview when filters hide it", async () => {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    units: [{ name: "Nos", whole: true }],
    capabilities: { Item: { create: true } },
    warehouses: [
      {
        name: "ROOM-A",
        label: "样例库房 / Room A",
        parent: "",
        is_group: false,
      },
    ],
  });
  const call = vi.fn<InventoryServices["call"]>(async (endpoint) => {
    if (endpoint === "catalog.picker_rows")
      return { results: [], matched_count: 0, next_start: null } as never;
    if (endpoint === "catalog.suggest_item_code")
      return { item_code: "ITEM-NEW" } as never;
    if (endpoint === "catalog.save_item")
      return {
        item_code: "ITEM-NEW",
        item_name: "新建样例服装",
        item_group: "",
        stock_uom: "Nos",
        image: "/private/files/new-item.webp",
        description: "",
        version: "v1",
        has_batch_no: false,
        has_expiry_date: false,
        can_edit: true,
        barcodes: [],
        uoms: [],
        attachments: [],
      } as never;
    if (endpoint === "table_preferences.get_column_preferences")
      return {} as never;
    throw new Error(`Unexpected ${endpoint}`);
  });
  const Host = defineComponent({
    setup() {
      provideInventoryServices(
        { call, upload: vi.fn(), report: vi.fn() },
        reference,
      );
      return () =>
        h(ItemPicker, {
          allowCreate: true,
          mode: "add-multiple",
          activeWarehouse: "ROOM-A",
        });
    },
  });
  const wrapper = mount(Host);
  wrappers.push(wrapper);
  await flushPromises();
  const click = async (label: string) => {
    const target = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(label),
    );
    if (!target) throw new Error(`Missing button ${label}`);
    target.click();
    await flushPromises();
  };
  await click("新建物品");
  const nameInput = document.querySelector<HTMLInputElement>("input[required]");
  if (!nameInput) throw new Error("Missing Item name input");
  nameInput.value = "新建样例服装";
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  await click("创建并使用物品");

  const preview = document.querySelector<HTMLElement>(
    ".picker-created-preview",
  );
  expect(preview?.textContent).toContain("刚创建 · 已选择");
  expect(preview?.textContent).toContain("新建样例服装 · ITEM-NEW");
  expect(preview?.textContent).toContain("样例库房 / Room A");
  const cover = preview?.querySelector<HTMLButtonElement>(".item-image-button");
  expect(cover?.style.width).toBe("48px");
  expect(cover?.style.height).toBe("48px");

  const search = document.querySelector<HTMLInputElement>(
    'input[type="search"]',
  );
  if (!search) throw new Error("Missing picker search input");
  search.value = "does-not-match";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  expect(document.querySelector(".picker-created-preview")).not.toBeNull();
  expect(
    document.querySelector(".picker-results-scroll")?.textContent,
  ).toContain("新建样例服装 · ITEM-NEW");
});

it("shows the initial table skeleton and dims retained rows during a filter request", async () => {
  const reference = createReferenceData();
  Object.assign(reference, { user: "volunteer", site: "unit-site" });
  let resolvePage!: (value: unknown) => void;
  let resolveInitial!: (value: unknown) => void;
  let requestCount = 0;
  const call = vi.fn<InventoryServices["call"]>(async (endpoint) => {
    if (endpoint === "table_preferences.get_column_preferences")
      return {} as never;
    if (endpoint === "catalog.picker_rows") {
      requestCount++;
      if (requestCount === 1) {
        return new Promise((resolve) => {
          resolveInitial = resolve;
        }) as never;
      }
      return new Promise((resolve) => {
        resolvePage = resolve;
      }) as never;
    }
    throw new Error(`Unexpected ${endpoint}`);
  });
  const Host = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(ItemPicker);
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  wrappers.push(wrapper);
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelectorAll(".data-table-skeleton-row").length).toBe(5);
  expect(document.body.textContent).not.toContain("0 个匹配物品");
  resolveInitial({
    results: [
      {
        item_code: "ITEM-A",
        item_name: "测试物品",
        item_group: "用品",
        stock_uom: "个",
        description: "",
        version: "v1",
        has_batch_no: false,
        has_expiry_date: false,
        can_edit: false,
        barcodes: [],
        uoms: [],
        stock: [],
        warehouse: "ROOM-A",
        warehouse_label: "演示室甲",
        picker_quantity: 2,
      },
    ],
    matched_count: 1,
    next_start: null,
  });
  await flushPromises();
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="搜索物品名称、编号或条码"]',
  );
  if (!search) throw new Error("Missing picker search input");
  search.value = "新筛选";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 240));
  await flushPromises();
  await nextTick();
  expect(requestCount).toBe(2);
  expect(
    document
      .querySelector(".picker-table-region")
      ?.getAttribute("data-refreshing") === "true",
  ).toBe(true);
  expect(document.querySelector(".data-table-skeleton-row")).toBeNull();
  resolvePage({ results: [], matched_count: 0, next_start: null });
  await flushPromises();
});
