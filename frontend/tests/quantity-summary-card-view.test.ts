import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import QuantitySummary from "../src/components/ui/QuantitySummary.vue";
import StockDetails from "../src/components/StockDetails.vue";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  expiryStatus,
  itemBatches,
  type StockItem,
} from "../src/lib/stockPresentation";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});
function item(changes: Partial<StockItem> = {}): StockItem {
  return {
    code: "ITEM-A",
    name: "大米",
    category: "食品",
    uom: "kg",
    available: 8,
    loaned: 3,
    damaged: 1,
    tracksBatch: true,
    tracksExpiry: true,
    locations: [
      {
        location: "ROOM-A",
        label: "东库",
        available: 8,
        loaned: 3,
        damaged: 1,
        batches: [
          { id: "BATCH-A", available: 5, expiry: "2026-10-15" },
          { id: "BATCH-B", available: 3, expiry: "2026-10-16" },
        ],
      },
    ],
    ...changes,
  };
}
async function inventory(rows: StockItem[]) {
  const host = defineComponent({
    setup() {
      const reference = createReferenceData();
      reference.siteDate = "2026-10-16";
      provideInventoryServices(
        {
          call: vi.fn(async () => ({
            rows,
            matched_count: rows.length,
            next_start: null,
            summary: [],
            snapshot: "2026-10-16",
            analysis: { category: [], location: [] },
          })) as never,
          report: vi.fn(),
          upload: vi.fn(),
        },
        reference,
      );
      return () => h(StockBrowsePage);
    },
  });
  const wrapper = mount(host, { attachTo: document.body });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
describe("native quantity summaries and inventory cards", () => {
  it("keeps incompatible units separate and labels a pending refresh", async () => {
    const wrapper = mount(QuantitySummary, {
      props: {
        metrics: [
          {
            key: "available",
            label: "可用",
            quantities: [
              { uom: "kg", qty: 2.5 },
              { uom: "件", qty: 4 },
            ],
          },
        ],
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.findAll(".quantity-summary-values strong")).toHaveLength(2);
    expect(wrapper.text()).toContain("2.5 kg");
    expect(wrapper.text()).toContain("4 件");
    await wrapper.setProps({ loading: true });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.text()).toContain("正在更新");
    expect(wrapper.find(".quantity-summary-values").exists()).toBe(true);
    expect(wrapper.text()).toContain("上次结果");
    await wrapper.setProps({
      metrics: [{ key: "available", label: "可用", quantities: [] }],
    });
    expect(wrapper.find(".quantity-summary-empty").exists()).toBe(false);
  });
  it("renders one Item card with available, loaned and damaged quantities, then retains its selected native code", async () => {
    const wrapper = await inventory([item()]);
    expect(wrapper.findAll(".stock-card")).toHaveLength(1);
    expect(wrapper.get(".stock-number strong").text()).toBe("8");
    expect(wrapper.get(".stock-secondary").text()).toContain("借出 3");
    expect(wrapper.get(".stock-secondary").text()).toContain("损坏 1");
    await wrapper.get('input[aria-label="选择大米"]').setValue(true);
    expect(
      wrapper.findComponent(StockBrowsePage).vm.controller.selected.value,
    ).toEqual(["ITEM-A"]);
    expect(wrapper.text()).toContain("已选择 1 项物品");
    await wrapper.get(".item-name").trigger("click");
    expect(
      wrapper.findComponent(StockBrowsePage).emitted("openItem")?.[0],
    ).toEqual(["ITEM-A"]);
  });
  it("keeps Item/Batch counts distinct across physical allocations and shows all scoped batch details", async () => {
    const value = item();
    value.locations.push({
      location: "ROOM-B",
      label: "西库",
      available: 2,
      loaned: 0,
      damaged: 0,
      batches: [{ id: "BATCH-A", available: 2, expiry: "2026-10-15" }],
    });
    expect(itemBatches(value)).toHaveLength(2);
    expect(
      itemBatches(value).find((batch) => batch.id === "BATCH-A")?.available,
    ).toBe(7);
    const wrapper = mount(StockDetails, {
      props: { item: value },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const trigger = wrapper
      .findAll("button")
      .find((button) => button.text() === "2 个批次")!;
    await trigger.trigger("click");
    expect(document.body.textContent).toContain("BATCH-A");
    expect(document.body.textContent).toContain("BATCH-B");
    expect(document.body.textContent).toContain("东库");
    expect(document.body.textContent).toContain("西库");
    expect(document.body.textContent).not.toContain("ROOM-A");
  });
  it("sorts the complete stock batch detail rows by a scalar quantity and shows one unit column", async () => {
    const wrapper = mount(StockDetails, {
      props: { item: item() },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const trigger = wrapper
      .findAll("button")
      .find((button) => button.text() === "2 个批次")!;
    await trigger.trigger("click");
    await flushPromises();
    const table = document.body.querySelector<HTMLElement>(".stock-breakdown")!;
    expect(table.textContent).toContain("单位");
    const quantityHeader = Array.from(
      table.querySelectorAll(".data-table-sort"),
    ).find((button) =>
      button.textContent?.includes("可用数量"),
    ) as HTMLButtonElement;
    quantityHeader.click();
    await flushPromises();
    const rows = Array.from(table.querySelectorAll("tbody tr")).map(
      (row) => row.textContent || "",
    );
    expect(rows[0]).toContain("BATCH-B");
    expect(rows[1]).toContain("BATCH-A");
    expect(rows.every((row) => (row.match(/kg/g) || []).length === 1)).toBe(
      true,
    );
  });
  it("uses the site date and treats expiry today as unexpired", () => {
    expect(expiryStatus(item(), "2026-10-16")).toBe("已过期");
    const today = item({
      locations: [
        {
          location: "ROOM-A",
          available: 1,
          loaned: 0,
          damaged: 0,
          batches: [{ id: "TODAY", available: 1, expiry: "2026-10-16" }],
        },
      ],
    });
    expect(expiryStatus(today, "2026-10-16")).toBe("未过期");
    expect(
      expiryStatus(item({ tracksExpiry: false }), "2026-10-16"),
    ).toBeNull();
    expect(expiryStatus(item({ locations: [] }), "2026-10-16")).toBeNull();
  });
  it("shows zero real batches without inventing a batch for an empty catalogue Item", () => {
    const wrapper = mount(StockDetails, {
      props: {
        item: item({ locations: [], available: 0, loaned: 0, damaged: 0 }),
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("0 批次");
    expect(wrapper.find("button").exists()).toBe(false);
    const untracked = mount(StockDetails, {
      props: {
        item: item({ tracksBatch: false, tracksExpiry: false, locations: [] }),
      },
    });
    wrappers.push(untracked);
    expect(untracked.text()).not.toContain("0 批次");
  });
});
