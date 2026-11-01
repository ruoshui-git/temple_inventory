// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import ProductDetailView from "../src/features/items/ProductDetailView.vue";
import type { ProductDetail } from "../src/features/items/useProductDetail";
import type { StockItem } from "../src/lib/stockPresentation";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("ProductDetailView", () => {
  it("shows identity, quantities, tracking, conversion, and non-image files in the top details", async () => {
    const item: StockItem = {
      code: "ITEM-0012",
      name: "铜磬",
      category: "法器",
      uom: "个",
      image: "/private/main.jpg",
      description: "供仪式使用\n保持干燥",
      barcode: "6901234",
      tracksBatch: true,
      tracksExpiry: true,
      alternateUnits: [{ uom: "箱", factor: 6 }],
      locations: [],
      available: 12,
      loaned: 2,
      damaged: 1,
    };
    const itemRecord = {
      item_code: item.code,
      has_serial_no: false,
      disabled: false,
      can_delete: true,
    };
    const attachments = [
      {
        id: "IMAGE-1",
        name: "侧面.jpg",
        type: "image/jpeg",
        url: "/private/side.jpg",
        primary: false,
        state: "ready" as const,
        progress: 100,
        error: "",
      },
      {
        id: "PDF-1",
        name: "说明.pdf",
        type: "application/pdf",
        url: "/private/manual.pdf",
        primary: false,
        state: "ready" as const,
        progress: 100,
        error: "",
      },
    ];
    const result = {
      rows: [],
      total: 0,
      next: null,
      loading: false,
      initialized: true,
      error: "",
      stale: false,
    };
    const controller = {
      item: ref(itemRecord),
      stockItem: ref(item),
      loading: ref(false),
      error: ref(""),
      tab: ref("overview"),
      batches: ref([]),
      serialRows: ref([
        {
          serial: "SN-ITEM-01",
          status: "在库",
          location: "一层货架",
          last_movement: { doctype: "Stock Entry", name: "STE-0001" },
        },
      ]),
      serialStatus: ref("Active"),
      serialSearch: ref(""),
      serialError: ref(""),
      serialNext: ref<number | null>(null),
      serialLoading: ref(false),
      loadSerials() {},
      files: {
        files: attachments,
        error: ref(""),
        loading: ref(false),
        initialized: ref(true),
      },
      exportQuery: ref({}),
      movementQuery: ref({}),
      loanQuery: ref({}),
      movements: {
        result,
        sortBy: ref("date"),
        sortDirection: ref("desc"),
        loadMore() {},
        refresh() {},
        setSort() {},
      },
      loans: {
        result,
        sortBy: ref("date"),
        sortDirection: ref("desc"),
        loadMore() {},
        refresh() {},
        setSort() {},
      },
      lifecycleBusy: ref(false),
      conversionDirty: ref(false),
      setDisabled() {},
      deleteItem() {},
      conversionsUpdated() {},
      load() {},
    };
    const wrapper = mount(ProductDetailView, {
      props: { controller: controller as unknown as ProductDetail },
      global: {
        stubs: {
          PageHeader: {
            template:
              "<header><slot /><slot name='back' /><slot name='actions' /></header>",
          },
          BackButton: true,
          QuickExport: true,
          PopupMenu: { template: "<div><slot /></div>" },
          MovementHistoryTable: true,
        },
      },
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".item-gallery").exists()).toBe(true);
    expect(wrapper.findAll(".item-gallery-thumbs button")).toHaveLength(2);
    expect(wrapper.text()).toContain("法器 · ITEM-0012");
    expect(wrapper.text()).toContain("铜磬");
    expect(wrapper.text()).toContain("6901234");
    expect(wrapper.text()).toContain("批次 + 效期");
    expect(wrapper.text()).toContain("12");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.text()).toContain("1");
    expect(wrapper.text()).toContain("1 箱 = 6 个");
    expect(wrapper.text()).toContain("供仪式使用");
    expect(wrapper.text()).not.toContain("物品编号");
    expect(wrapper.text()).not.toContain("按物品代码汇总");
    expect(wrapper.find(".browse-detail-grid").exists()).toBe(true);
    expect(wrapper.text()).toContain("说明.pdf");
    expect(wrapper.text()).not.toContain("侧面.jpg");
    expect(
      wrapper
        .findAll("summary")
        .some((summary) => summary.text().includes("计量单位与换算")),
    ).toBe(false);
    controller.item.value.has_serial_no = true;
    controller.tab.value = "serials";
    await flushPromises();
    expect(wrapper.text()).toContain("序列号");
    expect(wrapper.text()).toContain("SN-ITEM-01");
    expect(wrapper.text()).toContain("在库");
  });
});
