// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import PendingPage from "../src/features/pending/PendingPage.vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("pending browse view mode", () => {
  it("shows the same damaged row in card view and selects it for bulk actions", async () => {
    const query = newReportQuery("inventory");
    const report = vi.fn(async (value) => ({
      query: value,
      scope: value.scope,
      rows: [
        {
          id: "ITEM-A|ROOM-A|BATCH-A",
          item_code: "ITEM-A",
          item_name: "损坏工具",
          warehouse: "ROOM-A",
          warehouse_label: "库房 A",
          batch_no: "BATCH-A",
          stock_uom: "Nos",
          damaged: 3,
        },
      ],
      matched_count: 1,
      next_start: null,
      table: "locations",
      columns: [
        "item_name",
        "item_code",
        "damaged",
        "batch_no",
        "warehouse_label",
      ],
      tables: [{ id: "locations", label: "位置", count: 1 }],
      summary: [{ stock_uom: "Nos", damaged: 3 }],
      snapshot: "loaded",
      period: { date_from: "", date_to: "" },
    }));
    const reference = createReferenceData();
    Object.assign(reference, { user: "volunteer", site: "unit-site" });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/items/:code",
          name: "item-detail",
          component: { template: "<div />" },
        },
      ],
    });
    const root = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report, upload: vi.fn() } as never,
          reference,
        );
        return () => h(PendingPage, { initialQuery: query });
      },
    });
    const wrapper = mount(root, { global: { plugins: [router] } });
    wrappers.push(wrapper);
    await flushPromises();
    const toggle = wrapper.find('[aria-label="卡片视图"]');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger("click");
    await flushPromises();
    expect(wrapper.find(".pending-card-grid").text()).toContain("损坏工具");
    expect(wrapper.find(".pending-card-grid").text()).toContain("BATCH-A");
    const controller = wrapper.findComponent(PendingPage).vm.controller;
    controller.enterSelection();
    await flushPromises();
    const card = wrapper.find(".pending-card-grid [data-browse-row]");
    expect(card.exists()).toBe(true);
    await card.trigger("click");
    expect(controller.selected.value).toEqual(["ITEM-A|ROOM-A|BATCH-A"]);
  });
});
