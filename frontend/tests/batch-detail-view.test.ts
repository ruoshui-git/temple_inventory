// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import BatchDetailView from "../src/features/batches/BatchDetailView.vue";
import type { BatchDetailController } from "../src/features/batches/useBatchDetailController";
import {
  createReferenceData,
  provideReferenceData,
} from "../src/services/contracts";
import DataTable from "../src/components/ui/DataTable.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("BatchDetailView", () => {
  it("shows the item code once, expiry days, and honors editability and uniform units", async () => {
    const batch = {
      name: "BATCH-A",
      item_code: "ITEM-A",
      item: { item_code: "ITEM-A", item_name: "铜磬", image: "" },
      manufacturing_date: "2026-01-01",
      expiry_date: "2026-10-30",
      description: "避光保存",
      disabled: false,
      version: "v1",
      can_edit: false,
      locations: {
        rows: [{ id: "LOC-A", stock_uom: "个", stock_qty: 3, available: 2 }],
        matched_count: 1,
        next_start: null,
        summary: [{ stock_uom: "个", stock_qty: 3, available: 2 }],
      },
      history: { rows: [], matched_count: 0, next_start: null },
    };
    const controller = {
      batch: ref(batch),
      loading: ref(false),
      error: ref(""),
      success: ref(""),
      editing: ref(false),
      saving: ref(false),
      dirty: ref(false),
      validation: { errors: {} },
      locationsSortBy: ref("identity"),
      locationsSortDirection: ref("asc"),
      locationError: ref(""),
      locationsLoading: ref(false),
      historyLoading: ref(false),
      historyError: ref(""),
      beginEdit() {},
      cancelEdit() {},
      save() {},
      reload() {},
      moreLocations() {},
      moreHistory() {},
      sortLocations() {},
    };
    const reference = createReferenceData();
    reference.siteDate = "2026-10-01";
    const host = defineComponent({
      setup() {
        provideReferenceData(reference);
        return () =>
          h(BatchDetailView, {
            controller: controller as unknown as BatchDetailController,
          });
      },
    });
    const wrapper = mount(host, {
      global: {
        stubs: {
          PageHeader: {
            template:
              "<header><slot name='back' /><slot name='actions' /></header>",
            props: ["title"],
          },
          BackButton: true,
          ItemImage: true,
          QuantitySummary: true,
          MovementHistoryTable: true,
          FormField: true,
          UiButton: { template: "<button><slot /></button>" },
        },
      },
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find("header button").exists()).toBe(false);
    expect(wrapper.text()).toContain("即将到期 · 剩29天");
    expect(wrapper.text().match(/ITEM-A/g)).toHaveLength(1);
    expect(wrapper.text()).toContain("避光保存");
    const columns = wrapper.findComponent(DataTable).props("columns") as {
      id: string;
    }[];
    expect(columns.some((column) => column.id === "stock_uom")).toBe(false);
  });
});
