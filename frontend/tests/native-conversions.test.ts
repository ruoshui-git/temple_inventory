import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { useConversionEditor } from "../src/features/conversions/useConversionEditor";
import {
  conversionError,
  type ConversionLine,
} from "../src/lib/quantityConversion";
import type { StockItem } from "../src/lib/stockPresentation";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function setup() {
  const line = reactive<ConversionLine>({
    code: "ITEM-A",
    qty: 18,
    uom: "个",
    entryUom: "箱",
    entryQty: 2,
    conversionFactor: 9,
  });
  const item = reactive<StockItem>({
    code: "ITEM-A",
    name: "物品",
    category: "物资",
    uom: "个",
    tracksBatch: false,
    tracksExpiry: false,
    locations: [],
    available: 100,
    loaned: 0,
    damaged: 0,
    version: "v1",
    canEdit: true,
    alternateUnits: [
      { uom: "箱", factor: 6 },
      { uom: "包", factor: 3 },
    ],
  });
  const call = vi.fn();
  const applied = vi.fn(),
    dirty = vi.fn(),
    updated = vi.fn();
  let controller!: ReturnType<typeof useConversionEditor>;
  const reference = createReferenceData();
  reference.units = [
    { name: "个", whole: true },
    { name: "箱", whole: true },
    { name: "包", whole: true },
    { name: "kg", whole: false },
  ];
  reference.capabilities = { Item: { write: true }, UOM: { create: true } };
  const child = defineComponent({
    setup() {
      controller = useConversionEditor({ line, item }, applied, dirty, updated);
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
  wrappers.push(mount(root));
  return { controller, item, line, reference, call, applied, dirty, updated };
}

describe("recorded line and native reusable conversions", () => {
  it("keeps recorded factors when defaults change and preserves stock quantity when changing configured units", async () => {
    const { controller, line } = setup();
    expect(controller.factor.value).toBe(9);
    expect(line.qty).toBe(18);
    controller.unit.value = "个";
    await flushPromises();
    expect(controller.quantity.value).toBe(18);
    expect(controller.factor.value).toBe(1);
    controller.unit.value = "包";
    await flushPromises();
    expect(controller.quantity.value).toBe(6);
    expect(controller.factor.value).toBe(3);
    controller.unit.value = "箱";
    await flushPromises();
    expect(controller.factor.value).toBe(9);
    expect(controller.quantity.value).toBe(2);
    expect(line.conversionFactor).toBe(9);
  });
  it("does not apply a line after reusable save fails, and sends all existing conversions on explicit retry", async () => {
    const { controller, line, call, applied } = setup();
    controller.factor.value = 5;
    call
      .mockRejectedValueOnce(new Error("Item 保存失败"))
      .mockResolvedValueOnce({
        item_code: "ITEM-A",
        version: "v2",
        stock_uom: "个",
        conversions: [
          { uom: "箱", conversion_factor: 5 },
          { uom: "包", conversion_factor: 3 },
        ],
      });
    await controller.apply();
    expect(line.qty).toBe(18);
    expect(line.conversionFactor).toBe(9);
    expect(applied).not.toHaveBeenCalled();
    expect(controller.error.value).toBe("Item 保存失败");
    await controller.apply();
    expect(call).toHaveBeenLastCalledWith("conversions.save_item_conversions", {
      item_code: "ITEM-A",
      version: "v1",
      conversions: [
        { uom: "包", conversion_factor: 3 },
        { uom: "箱", conversion_factor: 5 },
      ],
    });
    expect(line.qty).toBe(10);
    expect(applied).toHaveBeenCalledTimes(1);
  });
  it("applies unchecked conversion only to the allocation without writing Item", async () => {
    const { controller, line, call, applied } = setup();
    controller.reuse.value = false;
    controller.factor.value = 4;
    await controller.apply();
    expect(line.entryQty).toBe(2);
    expect(line.qty).toBe(8);
    expect(call).not.toHaveBeenCalled();
    expect(applied).toHaveBeenCalledTimes(1);
  });
  it("requires reloading a stale Item version while retaining the staged quantity and factor", async () => {
    const { controller, line, call } = setup();
    controller.factor.value = 5;
    call
      .mockRejectedValueOnce(
        Object.assign(new Error("Item 已更改"), {
          kind: "TimestampMismatchError",
        }),
      )
      .mockResolvedValueOnce({
        version: "v3",
        stock_uom: "个",
        uoms: [
          { uom: "箱", conversion_factor: 7 },
          { uom: "包", conversion_factor: 3 },
        ],
      })
      .mockResolvedValueOnce({
        item_code: "ITEM-A",
        version: "v4",
        stock_uom: "个",
        conversions: [{ uom: "箱", conversion_factor: 5 }],
      });
    await controller.apply();
    await controller.apply();
    expect(call).toHaveBeenCalledTimes(1);
    await controller.reload();
    expect(controller.factor.value).toBe(5);
    expect(controller.quantity.value).toBe(2);
    expect(line.qty).toBe(18);
    await controller.apply();
    expect(call).toHaveBeenLastCalledWith(
      "conversions.save_item_conversions",
      expect.objectContaining({ version: "v3" }),
    );
  });
  it("does not replace an unknown factor with one, round fractional whole stock, or accept nonfinite values", async () => {
    const { controller, line, reference, call } = setup();
    controller.unit.value = "kg";
    await flushPromises();
    expect(controller.factor.value).toBe("");
    controller.reuse.value = false;
    controller.factor.value = 2.5;
    controller.quantity.value = 1;
    await controller.apply();
    expect(controller.error.value).toContain("整数");
    expect(line.qty).toBe(18);
    expect(call).not.toHaveBeenCalled();
    for (const factor of [NaN, Infinity, 0, -1, 1.0000001])
      expect(conversionError(1, "kg", factor, "个", reference.units)).not.toBe(
        "",
      );
  });
  it("keeps UOM and Item permission separate and allows historical recorded factors", async () => {
    const { controller, line, item, call } = setup();
    item.canEdit = false;
    await flushPromises();
    expect(controller.reuse.value).toBe(false);
    controller.factor.value = 5;
    await controller.apply();
    expect(controller.error.value).toContain("已有或本行已记录");
    expect(line.qty).toBe(18);
    controller.factor.value = 9;
    await controller.apply();
    expect(call).not.toHaveBeenCalled();
    expect(line.conversionFactor).toBe(9);
  });
});
