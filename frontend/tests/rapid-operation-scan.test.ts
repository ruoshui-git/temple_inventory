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
const stubs = {
  ItemPicker: PickerStub,
  UiButton: ButtonStub,
  AllocationDetails: true,
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
  kind: "Receive" | "Issue" | "Transfer" = "Issue",
  items: StockItem[] = [stockItem()],
  initialLines: Record<string, unknown>[] = [],
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
  const services: InventoryServices = {
    call: vi.fn(
      async () =>
        ({ results: [], matched_count: 0, next_start: null }) as never,
    ),
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
  const wrapper = mount(root, { global: { stubs } });
  wrappers.push(wrapper);
  return { wrapper, draft, reference, context, stock };
}

async function openPicker(wrapper: VueWrapper) {
  const add = wrapper
    .findAll("button")
    .find((button) => button.text() === "添加物品");
  expect(add).toBeTruthy();
  await add!.trigger("click");
  await flushPromises();
  return wrapper.findComponent(PickerStub);
}

describe("rapid operation scan integration", () => {
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
    picker.vm.$emit("select", { code: "ITEM-A", warehouse: "ROOM-B" });
    await flushPromises();
    expect(context.ensure).toHaveBeenCalledWith("ITEM-A");
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
});
