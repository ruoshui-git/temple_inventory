// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import { newOperation } from "../src/features/documents/operationCodec";
import {
  provideOperationContext,
  type OperationContext,
} from "../src/features/documents/operationModel";
import type { StockItem } from "../src/lib/stockPresentation";
import ItemPicker from "../src/features/items/ItemPicker.vue";
import OperationLines from "../src/features/documents/OperationLines.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

const PickerStub = defineComponent({
  name: "ItemPicker",
  props: [
    "onOperationScan",
    "scanResolution",
    "scanLines",
    "scanFeedback",
    "canUndoScan",
    "activeWarehouse",
    "context",
    "scanDestination",
    "scanDestinationOptions",
  ],
  emits: [
    "close",
    "select",
    "selectMultiple",
    "resolveScan",
    "cancelScanResolution",
    "undoScan",
    "finishScan",
  ],
  template: "<div data-test='picker-stub'></div>",
});
const ButtonStub = defineComponent({
  name: "UiButton",
  props: ["disabled", "type", "loading", "variant", "ariaPressed"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" :type="type || \'button\'" @click="$emit(\'click\')"><slot /></button>',
});
const SearchSelectStub = defineComponent({
  name: "SearchSelect",
  inheritAttrs: false,
  props: ["label", "modelValue", "options", "disabled"],
  emits: ["update:modelValue"],
  template:
    '<button type="button" v-bind="$attrs" :disabled="disabled">{{ label }}: {{ modelValue }}</button>',
});
const stubs = {
  ItemPicker: PickerStub,
  UiButton: ButtonStub,
  AllocationSummary: true,
  ItemImage: true,
  SearchSelect: true,
};

function stockItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    code: "ITEM-A",
    name: "物品甲",
    category: "用品",
    uom: "Nos",
    tracksBatch: false,
    tracksExpiry: false,
    locations: [{ location: "ROOM-A", available: 5, loaned: 0, damaged: 0 }],
    available: 5,
    loaned: 0,
    damaged: 0,
    ...overrides,
  };
}

function setup(
  kind:
    "Receive" | "Issue" | "Transfer" | "Damage" | "Loss" | "Return" = "Issue",
  items: StockItem[] = [stockItem()],
  initialLines: Record<string, unknown>[] = [],
  withSelectors = false,
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "scan-test.local",
    user: "operator",
    siteDate: "2026-10-21",
    siteTime: "2026-10-21 10:00:00",
    physicalLeaves: ["ROOM-A", "ROOM-B"],
    leasedLeaves: ["LEASED-A"],
    damagedLeaves: ["ROOM-A"],
    warehouses: [
      { name: "ROOM-A", label: "房间甲", parent: "", is_group: false },
      { name: "ROOM-B", label: "房间乙", parent: "", is_group: false },
      { name: "LEASED-A", label: "借用区", parent: "", is_group: false },
    ],
  });
  const draft = reactive(newOperation(kind, reference));
  draft.preferredWarehouse = "ROOM-A";
  draft.items.push(
    ...initialLines.map((line) => ({
      id: String(line.id),
      localId: String(line.id),
      code: String(line.code || "ITEM-A"),
      qty: Number(line.qty || 1),
      uom: String(line.uom || "Nos"),
      entryUom: String(line.entryUom || "Nos"),
      entryQty: Number(line.entryQty || line.qty || 1),
      conversionFactor: Number(line.conversionFactor || 1),
      location: String(line.location || "ROOM-A"),
      sourceLocation: String(line.sourceLocation || line.location || "ROOM-A"),
      batch: String(line.batch || ""),
      ...line,
    })),
  );
  const stock = reactive(items);
  const findItem = (code: string) => stock.find((item) => item.code === code);
  const context: OperationContext = {
    stock,
    remember: vi.fn(),
    ensure: vi.fn(async (code: string) => {
      const item = findItem(code);
      if (!item) throw new Error("物品不存在");
      return item;
    }),
    ensureMany: vi.fn(
      async (codes: string[]) =>
        new Map(
          codes.flatMap((code) => {
            const item = findItem(code);
            return item ? [[code, item] as const] : [];
          }),
        ),
    ),
    timestamp: () => "2026-10-21 10:00:00",
    issues: () => [],
    lineStock: (line) =>
      findItem(line.code)?.locations.find(
        (location) =>
          location.location === (line.sourceLocation || line.location),
      ),
    lineCapacity: (_draft, line) => {
      const item = findItem(line.code);
      const place = item?.locations.find(
        (row) => row.location === (line.sourceLocation || line.location),
      );
      if (!item || !place) return 0;
      return item.tracksBatch
        ? place.batches?.find((batch) => batch.id === line.batch)?.available ||
            0
        : place.available;
    },
  };
  const call = vi.fn(
    async () => ({ results: [], matched_count: 0, next_start: null }) as never,
  );
  const services: InventoryServices = {
    call,
    report: vi.fn(
      async () => ({ rows: [], matched_count: 0, next_start: null }) as never,
    ),
    upload: vi.fn(async () => ({})),
  };
  const root = defineComponent({
    setup() {
      provideInventoryServices(services, reference);
      provideOperationContext(context);
      return () => h(OperationLines, { draft, active: true });
    },
  });
  const wrapper = mount(root, {
    global: {
      stubs: withSelectors
        ? { ...stubs, SearchSelect: SearchSelectStub }
        : stubs,
    },
  });
  wrappers.push(wrapper);
  return { wrapper, draft, reference, context, stock, call };
}

async function openPicker(wrapper: VueWrapper) {
  const add = wrapper.find('button[aria-label="添加物品"]').exists()
    ? wrapper.find('button[aria-label="添加物品"]')
    : wrapper.findAll("button").find((button) => button.text() === "添加物品");
  expect(add).toBeTruthy();
  await add!.trigger("click");
  await flushPromises();
  return wrapper.findComponent(PickerStub);
}

describe("rapid operation scan integration", () => {
  it("renders each batch as a native row with its own unit and duplicates it blank", async () => {
    const tracked = stockItem({
      tracksBatch: true,
      tracksExpiry: true,
      locations: [
        {
          location: "ROOM-A",
          available: 5,
          loaned: 0,
          damaged: 0,
          batches: [
            {
              id: "BATCH-A",
              available: 2,
              damaged: 0,
              expiry: "2027-01-01",
            },
            {
              id: "BATCH-B",
              available: 3,
              damaged: 0,
              expiry: "2027-02-01",
            },
          ],
        },
      ],
    });
    const { wrapper, draft } = setup(
      "Receive",
      [tracked],
      [
        {
          id: "batch-row-a",
          code: "ITEM-A",
          qty: 2,
          entryQty: 1,
          entryUom: "Box",
          conversionFactor: 2,
          location: "ROOM-A",
          batch: "BATCH-A",
          expiry: "2027-01-01",
        },
        {
          id: "batch-row-b",
          code: "ITEM-A",
          qty: 3,
          entryQty: 3,
          entryUom: "Nos",
          location: "ROOM-A",
          batch: "BATCH-B",
          expiry: "2027-02-01",
        },
      ],
      true,
    );

    const rows = wrapper.findAll(".operation-compact-row");
    expect(rows).toHaveLength(2);
    expect(
      rows.map(
        (row) =>
          (row.get('input[data-field="batch"]').element as HTMLInputElement)
            .value,
      ),
    ).toEqual(["BATCH-A", "BATCH-B"]);
    expect(draft.items.map((line) => line.entryUom)).toEqual(["Box", "Nos"]);
    const originalIds = draft.items.map((line) => line.id);
    const duplicate = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制为新行");
    expect(duplicate).toBeTruthy();
    await duplicate!.trigger("click");
    expect(draft.items).toHaveLength(3);
    expect(
      draft.items
        .filter((line) => originalIds.includes(line.id))
        .map((line) => line.id),
    ).toEqual(originalIds);
    expect(draft.items[1]).toMatchObject({
      batch: "",
      entryUom: "Box",
      entryQty: 0,
      qty: 0,
    });
    expect(wrapper.findAll(".operation-compact-row")).toHaveLength(3);
  });

  it("marks required line columns and shows a converted stock total beside the unit", async () => {
    const tracked = stockItem({
      tracksBatch: true,
      tracksExpiry: true,
      alternateUnits: [{ uom: "Box", factor: 12 }],
    });
    const plain = stockItem({ code: "ITEM-B", name: "普通物品" });
    const { wrapper, reference } = setup(
      "Receive",
      [tracked, plain],
      [
        {
          id: "converted-row",
          code: "ITEM-A",
          qty: 10080,
          entryQty: 840,
          entryUom: "Box",
          conversionFactor: 12,
          location: "ROOM-A",
          batch: "BATCH-A",
        },
        {
          id: "plain-row",
          code: "ITEM-B",
          qty: 3,
          entryQty: 3,
          entryUom: "Nos",
          conversionFactor: 1,
          location: "ROOM-A",
        },
      ],
      true,
    );
    reference.units = [
      { name: "Nos", label: "个", whole: true },
      { name: "Box", label: "箱", whole: true },
    ];
    await flushPromises();
    const headings = wrapper.get(".operation-column-headings").text();
    expect(headings).toMatch(/物品\s+\*/);
    expect(headings).toMatch(/数量\s+\*/);
    expect(headings).toMatch(/单位\s+\*/);
    expect(headings).toMatch(/效期\s+\*/);
    expect(headings).toMatch(/生产日期\s+可选/);
    expect(wrapper.get(".operation-row-stock-total").text()).toContain(
      "= 10,080 个",
    );
    const rowEls = wrapper.findAll(".operation-compact-row");
    const gridTemplate = wrapper
      .get(".operation-column-headings")
      .element.getAttribute("style");
    expect(gridTemplate).toContain("minmax(132px, 0.95fr)");
    expect(gridTemplate).toContain("88px 96px 88px");
    for (const row of rowEls) {
      expect(row.element.getAttribute("style")).toBe(gridTemplate);
      expect(
        row.findAll(".operation-row-batch .operation-row-cell"),
      ).toHaveLength(3);
      expect(
        row.findAll(
          ".operation-row-stock-total, .operation-row-stock-total-empty",
        ),
      ).toHaveLength(1);
    }
    const unitPicker = wrapper
      .findAllComponents(SearchSelectStub)
      .find((field) => String(field.props("label")).includes("单位"));
    expect(unitPicker?.props("options")).toContainEqual({
      value: "Box",
      label: "箱",
      detail: "Box · 1 箱 = 12 个",
    });
  });

  it("shows damage reason and Return outcome as editable row fields", async () => {
    const damage = setup(
      "Damage",
      [stockItem()],
      [{ id: "damage-row", reason: "磨损" }],
      true,
    );
    expect(
      damage.wrapper.find(".operation-row-reason input").element,
    ).toHaveProperty("value", "磨损");
    const returned = setup(
      "Return",
      [stockItem()],
      [{ id: "return-row", loanName: "LOAN-1", returnOutcome: "damaged" }],
      true,
    );
    const outcome = returned.wrapper
      .findAllComponents(SearchSelectStub)
      .find((select) => String(select.props("label")).endsWith("归还结果"));
    expect(outcome?.props("modelValue")).toBe("damaged");
    outcome?.vm.$emit("update:modelValue", "returned");
    await flushPromises();
    expect(returned.draft.items[0]?.returnOutcome).toBe("returned");
  });

  it("keeps the picker warehouse as transfer source and uses the toolbar destination for new rows", async () => {
    const itemInA02 = stockItem({
      code: "ITEM-B",
      locations: [
        {
          location: "A02",
          label: "A02",
          available: 5,
          loaned: 0,
          damaged: 0,
        },
        {
          location: "冷藏柜 / 上层",
          label: "上层",
          available: 0,
          loaned: 0,
          damaged: 0,
        },
      ],
    });
    const { wrapper, draft, reference } = setup(
      "Transfer",
      [
        stockItem({
          locations: [
            {
              location: "A02",
              label: "A02",
              available: 5,
              loaned: 0,
              damaged: 0,
            },
          ],
        }),
        itemInA02,
      ],
      [
        {
          id: "existing-transfer-line",
          code: "ITEM-A",
          sourceLocation: "A02",
          location: "冷藏柜 / 上层",
        },
      ],
      true,
    );
    reference.physicalLeaves.splice(0, Infinity, "A02", "冷藏柜 / 上层");
    Object.assign(reference.warehouses[0]!, {
      name: "A02",
      label: "A02",
      short_label: "A02",
      full_label: "厨房 / A02",
      path: "DS / ZT / 厨房 / A02",
    });
    Object.assign(reference.warehouses[1]!, {
      name: "冷藏柜 / 上层",
      label: "上层",
      short_label: "上层",
      full_label: "冷藏柜 / 上层",
      path: "DS / ZT / 冷藏柜 / 上层",
    });
    draft.preferredWarehouse = "A02";
    await flushPromises();
    const destination = wrapper
      .findAllComponents(SearchSelectStub)
      .find((selector) => selector.props("label") === "调入位置");
    expect(destination).toBeTruthy();
    expect(
      (destination!.props("options") as Array<{ value: string }>).map(
        (option) => option.value,
      ),
    ).toEqual(["冷藏柜 / 上层"]);
    destination!.vm.$emit("update:modelValue", "冷藏柜 / 上层");
    await flushPromises();

    const picker = await openPicker(wrapper);
    picker.vm.$emit("selectMultiple", [{ code: "ITEM-B", warehouse: "A02" }]);
    await flushPromises();

    const added = draft.items.find((line) => line.code === "ITEM-B");
    expect(added).toMatchObject({
      sourceLocation: "A02",
      location: "冷藏柜 / 上层",
    });
    const lineSource = wrapper
      .findAllComponents(SearchSelectStub)
      .find((selector) => selector.props("label") === "调出位置");
    expect(lineSource?.props("modelValue")).toBe("A02");
    const lineDestination = wrapper
      .findAllComponents(SearchSelectStub)
      .find((selector) => String(selector.props("label")).endsWith("调入位置"));
    expect(
      (lineDestination!.props("options") as Array<{ value: string }>).map(
        (option) => option.value,
      ),
    ).toEqual(["冷藏柜 / 上层"]);
    expect(
      (lineDestination!.props("options") as Array<{ value: string }>).some(
        (option) => option.value === added!.sourceLocation,
      ),
    ).toBe(false);
  });

  it("binds the selected warehouse and its batch after loading complete item context", async () => {
    const item = stockItem({
      tracksBatch: true,
      locations: [
        {
          location: "ROOM-A",
          available: 2,
          loaned: 0,
          damaged: 0,
          batches: [{ id: "BATCH-A", available: 2 }],
        },
        {
          location: "ROOM-B",
          available: 3,
          loaned: 0,
          damaged: 0,
          batches: [{ id: "BATCH-B", available: 3 }],
        },
      ],
    });
    const { wrapper, draft, context } = setup("Issue", [item]);
    const picker = await openPicker(wrapper);
    expect(picker.props("context")).toBe("出库 · ");
    picker.vm.$emit("select", { code: "ITEM-A", warehouse: "ROOM-B" });
    await flushPromises();
    expect(context.ensure).not.toHaveBeenCalled();
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      sourceLocation: "ROOM-B",
      batch: "BATCH-B",
    });
    expect(context.lineCapacity(draft, draft.items[0]!)).toBe(3);
  });
  it("adds one stock unit per accepted scan, merges compatible lines and undoes only the latest increment", async () => {
    const { wrapper, draft } = setup();
    const picker = await openPicker(wrapper);
    const accept = picker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;

    await accept("ITEM-A", undefined, { activeWarehouse: "ROOM-A" });
    await accept("ITEM-A", undefined, { activeWarehouse: "ROOM-A" });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      code: "ITEM-A",
      qty: 2,
      entryQty: 2,
      uom: "Nos",
      sourceLocation: "ROOM-A",
    });
    expect(picker.props("scanFeedback")).toContain("×1 Nos");
    expect(picker.props("scanLines")).toMatchObject([
      { code: "ITEM-A", qty: 2, uom: "Nos" },
    ]);

    draft.items[0]!.note = "手工填写资料";
    picker.vm.$emit("undoScan");
    await flushPromises();
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      qty: 1,
      entryQty: 1,
      note: "手工填写资料",
    });
    expect(picker.props("canUndoScan")).toBe(true);
  });

  it("scopes a scan to its captured warehouse and rejects capacity below one stock unit", async () => {
    const { wrapper, draft } = setup("Issue", [
      stockItem({
        locations: [
          { location: "ROOM-A", available: 0.5, loaned: 0, damaged: 0 },
          { location: "ROOM-B", available: 6, loaned: 0, damaged: 0 },
        ],
      }),
    ]);
    const picker = await openPicker(wrapper);
    const accept = picker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    const pending = accept("ITEM-A", undefined, { activeWarehouse: "ROOM-A" });
    await flushPromises();
    expect(picker.props("scanResolution")).toMatchObject({
      sourceRequired: true,
      sourceOptions: [],
    });
    picker.vm.$emit("resolveScan", {
      code: "ITEM-A",
      source: "ROOM-B",
      batch: "",
      destination: "",
    });
    await flushPromises();
    expect(draft.items).toHaveLength(0);
    expect(picker.props("scanResolution")).toBeTruthy();
    picker.vm.$emit("cancelScanResolution");
    await pending;

    const preferredDraftLine = {
      id: "manual-request",
      code: "ITEM-A",
      qty: 1,
      entryQty: 1,
      entryUom: "Nos",
      conversionFactor: 1,
      uom: "Nos",
      location: "ROOM-A",
      sourceLocation: "ROOM-A",
    };
    const capacitySetup = setup(
      "Issue",
      [
        stockItem({
          locations: [
            { location: "ROOM-A", available: 2, loaned: 0, damaged: 0 },
          ],
        }),
      ],
      [preferredDraftLine],
    );
    const capacityPicker = await openPicker(capacitySetup.wrapper);
    const capacityAccept = capacityPicker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    await capacityAccept("ITEM-A", undefined, { activeWarehouse: "ROOM-A" });
    expect(capacitySetup.draft.items).toHaveLength(1);
    expect(capacitySetup.draft.items[0]?.qty).toBe(2);
    const exhausted = capacityAccept("ITEM-A", undefined, {
      activeWarehouse: "ROOM-A",
    });
    await flushPromises();
    expect(capacityPicker.props("scanResolution")).toMatchObject({
      sourceOptions: [],
    });
    capacityPicker.vm.$emit("cancelScanResolution");
    await exhausted;
  });

  it("requires a batch choice, revalidates it, and merges only scans for that batch and destination", async () => {
    const item = stockItem({
      tracksBatch: true,
      locations: [
        {
          location: "ROOM-A",
          available: 4,
          loaned: 0,
          damaged: 0,
          batches: [
            { id: "BATCH-1", available: 2 },
            { id: "BATCH-2", available: 2 },
          ],
        },
      ],
    });

    const { wrapper, draft } = setup("Transfer", [item]);
    const picker = await openPicker(wrapper);
    const accept = picker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    const pending = accept("ITEM-A", undefined, {
      activeWarehouse: "ROOM-A",
      destination: "ROOM-B",
    });
    await flushPromises();
    expect(picker.props("scanResolution")).toMatchObject({
      batchRequired: true,
      defaultSource: "ROOM-A",
    });
    expect(
      picker
        .props("scanResolution")
        .batchOptions.map((option: { value: string }) => option.value),
    ).toEqual(["BATCH-1", "BATCH-2"]);
    picker.vm.$emit("resolveScan", {
      code: "ITEM-A",
      source: "ROOM-A",
      batch: "BATCH-2",
      destination: "ROOM-B",
    });
    await pending;
    await accept("ITEM-A", "BATCH-2", {
      activeWarehouse: "ROOM-A",
      destination: "ROOM-B",
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      qty: 2,
      batch: "BATCH-2",
      sourceLocation: "ROOM-A",
      location: "ROOM-B",
    });
  });

  it("reuses an explicitly resolved allocation until it is unavailable, without switching batches", async () => {
    const item = stockItem({
      tracksBatch: true,
      locations: [
        {
          location: "ROOM-A",
          available: 4,
          loaned: 0,
          damaged: 0,
          batches: [
            { id: "BATCH-1", available: 2 },
            { id: "BATCH-2", available: 2 },
          ],
        },
      ],
    });
    const { wrapper, draft } = setup("Transfer", [item]);
    const picker = await openPicker(wrapper);
    const accept = picker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    const firstScan = accept("ITEM-A", undefined, {
      activeWarehouse: "ROOM-A",
      destination: "ROOM-B",
    });
    await flushPromises();
    expect(picker.props("scanResolution")).toMatchObject({
      batchRequired: true,
      defaultSource: "ROOM-A",
    });
    picker.vm.$emit("resolveScan", {
      code: "ITEM-A",
      source: "ROOM-A",
      batch: "BATCH-2",
      destination: "ROOM-B",
    });
    await firstScan;
    expect(picker.props("activeWarehouse")).toBe("ROOM-A");

    const currentContext = {
      activeWarehouse: picker.props("activeWarehouse"),
      destination: picker.props("scanDestination"),
    };
    expect(currentContext).toEqual({
      activeWarehouse: "ROOM-A",
      destination: "ROOM-B",
    });
    await accept("ITEM-A", undefined, currentContext);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ qty: 2, batch: "BATCH-2" });
    expect(picker.props("scanResolution")).toBeUndefined();

    const exhaustedBatch = accept("ITEM-A", undefined, currentContext);
    await flushPromises();
    expect(draft.items[0]).toMatchObject({ qty: 2, batch: "BATCH-2" });
    expect(picker.props("scanResolution")).toMatchObject({
      batchRequired: true,
      defaultBatch: "",
    });
    expect(
      picker
        .props("scanResolution")
        .batchOptions.map((option: { value: string }) => option.value),
    ).toEqual(["BATCH-1"]);
    picker.vm.$emit("cancelScanResolution");
    await exhaustedBatch;
  });

  it("requires a valid destination for transfers and lets receipts add items with zero stock", async () => {
    const transfer = setup("Transfer");
    transfer.reference.physicalLeaves.splice(0);
    const transferPicker = await openPicker(transfer.wrapper);
    const transferAccept = transferPicker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    const transferPending = transferAccept("ITEM-A", undefined, {
      activeWarehouse: "ROOM-A",
      destination: "",
    });
    await flushPromises();
    expect(transferPicker.props("scanResolution")).toMatchObject({
      destinationRequired: true,
      destinationOptions: [],
    });
    transferPicker.vm.$emit("resolveScan", {
      code: "ITEM-A",
      source: "ROOM-A",
      batch: "",
      destination: "ROOM-B",
    });
    await flushPromises();
    expect(transfer.draft.items).toHaveLength(0);
    transferPicker.vm.$emit("cancelScanResolution");
    await transferPending;

    const receive = setup("Receive", [
      stockItem({ available: 0, locations: [] }),
    ]);
    const receivePicker = await openPicker(receive.wrapper);
    const receiveAccept = receivePicker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    await receiveAccept("ITEM-A", undefined, { destination: "ROOM-A" });
    expect(receive.draft.items).toHaveLength(1);
    expect(receive.draft.items[0]).toMatchObject({
      qty: 1,
      sourceLocation: "",
      location: "ROOM-A",
    });
  });

  it("moves only the presentation order after an accepted scan and keeps native child order unchanged", async () => {
    const a = stockItem({
      code: "ITEM-A",
      name: "物品甲",
      locations: [{ location: "ROOM-A", available: 4, loaned: 0, damaged: 0 }],
    });
    const b = stockItem({
      code: "ITEM-B",
      name: "物品乙",
      locations: [{ location: "ROOM-A", available: 4, loaned: 0, damaged: 0 }],
    });
    const { wrapper, draft } = setup(
      "Issue",
      [a, b],
      [
        {
          id: "native-a",
          code: "ITEM-A",
          qty: 1,
          entryQty: 1,
          location: "ROOM-A",
          sourceLocation: "ROOM-A",
        },
        {
          id: "native-b",
          code: "ITEM-B",
          qty: 1,
          entryQty: 1,
          location: "ROOM-A",
          sourceLocation: "ROOM-A",
        },
      ],
    );
    const picker = await openPicker(wrapper);
    const accept = picker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    await accept("ITEM-B", undefined, { activeWarehouse: "ROOM-A" });
    await accept("ITEM-A", undefined, { activeWarehouse: "ROOM-A" });
    await flushPromises();
    expect(draft.items.map((line) => line.id)).toEqual([
      "native-a",
      "native-b",
    ]);
    expect(
      wrapper
        .findAll("[data-line-id]")
        .map((row) => row.attributes("data-line-id")),
    ).toEqual(["native-a", "native-b"]);
    expect(
      (picker.props("scanLines") as Array<{ id: string }>).map(
        (line) => line.id,
      ),
    ).toEqual(["native-a", "native-b"]);
    const manualInput = wrapper.get(
      '[data-line-id="native-a"] input[data-field="qty"]',
    );
    await manualInput.setValue("2");
    await flushPromises();
    expect(
      wrapper
        .findAll("[data-line-id]")
        .map((row) => row.attributes("data-line-id")),
    ).toEqual(["native-a", "native-b"]);
    expect(draft.items.map((line) => line.id)).toEqual([
      "native-a",
      "native-b",
    ]);
  });

  it("does not write a scan whose item lookup finishes after the picker closes", async () => {
    let finish!: (value: StockItem) => void;
    const { wrapper, draft, context } = setup();
    (context.ensure as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<StockItem>((resolve) => (finish = resolve)),
    );
    const picker = await openPicker(wrapper);
    const accept = picker.props("onOperationScan") as (
      code: string,
      batch?: string,
      context?: unknown,
    ) => Promise<void>;
    const pending = accept("ITEM-A", undefined, { activeWarehouse: "ROOM-A" });
    await picker.vm.$emit("close");
    await flushPromises();
    finish(stockItem());
    await pending;
    expect(draft.items).toHaveLength(0);
  });

  it("derives a reopened Receive destination from its lines without saving a preference", async () => {
    const receive = setup(
      "Receive",
      [stockItem()],
      [{ id: "existing-line", location: "ROOM-B" }],
      true,
    );
    await flushPromises();
    const selector = receive.wrapper
      .findAllComponents(SearchSelectStub)
      .find((component) => component.props("label") === "入库位置");
    expect(selector?.props("modelValue")).toBe("ROOM-B");
    expect(receive.call).not.toHaveBeenCalledWith(
      "preferences.save_creation_location",
      expect.anything(),
    );
  });
});
