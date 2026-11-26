// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import CountEditorPage from "../src/features/counts/CountEditorPage.vue";
import ItemImage from "../src/components/ItemImage.vue";
import QuickExport from "../src/components/QuickExport.vue";
import type { NativeDocument } from "../src/features/documents/nativeEditor";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

enableAutoUnmount(afterEach);
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  { layout: "desktop", desktop: true, status: 1 },
  { layout: "phone", desktop: false, status: 1 },
  { layout: "phone after cancellation", desktop: false, status: 2 },
] as const)(
  "shows a thumbnail per count difference on $layout",
  async ({ desktop, status }) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: desktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const doc: NativeDocument = {
      doctype: "Stock Reconciliation",
      name: "COUNT-TEST",
      version: "v1",
      purpose: "Stock Reconciliation",
      docstatus: status,
      editable: false,
      ti_count_review: [
        {
          item_code: "CUP",
          image: "/files/cup.png",
          item_name: "杯",
          warehouse: "ROOM",
          batch_no: null,
          stock_uom: "Nos",
          baseline_qty: 1,
          actual_qty: 2,
          review_state: "Reviewed",
          reason: "",
        },
      ],
      items: [
        {
          item_code: "CHAIR",
          item_name: "椅子",
          ti_display_image: "/files/chair.png",
          image: "/files/old-chair.png",
        },
        { item_code: "TABLE", item_name: "桌子", image: "/files/table.png" },
        { item_code: "CUP", item_name: "杯" },
      ].map((row) => ({
        ...row,
        name: row.item_code,
        stock_uom: "Nos",
        warehouse: "ROOM",
        qty: 2,
        current_qty: 1,
      })),
    };
    const call = vi.fn(async (method: string) => {
      if (method === "native_api.load_document") return doc;
      if (method === "table_preferences.get_column_preferences") return {};
      return [];
    });
    const reference = createReferenceData();
    Object.assign(reference, { site: "thumbnail-test", user: "viewer" });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(
            { call, report: vi.fn(), upload: vi.fn() },
            reference,
          );
          return () => h(CountEditorPage, { name: doc.name });
        },
      }),
    );
    await flushPromises();

    expect(wrapper.find(".count-summary-disclosure").exists()).toBe(!desktop);
    const table = wrapper.get(".count-readonly-table");
    expect(
      table
        .findAll("th")
        .slice(0, 2)
        .map((heading) => heading.text()),
    ).toEqual(["图片", "物品"]);
    expect(
      table
        .findAllComponents(ItemImage)
        .map((thumbnail) => thumbnail.props("item").image),
    ).toEqual(["/files/chair.png", "/files/table.png", "/files/cup.png"]);
    expect(call.mock.calls.map(([method]) => method)).not.toContain(
      "catalog.item_summaries",
    );
    const exportButton = wrapper.getComponent(QuickExport);
    expect(exportButton.props("table")).toBe("lines");
    expect(exportButton.props("columns")).toContain("item_name");
    expect(exportButton.props("columns")).not.toContain("image");
  },
);
