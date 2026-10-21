import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import ReportTable from "../src/components/ui/ReportTable.vue";
const table = (length = 65) => ({
  id: "records",
  label: "原生记录",
  columns: ["document", "stock_qty", "notes", "has_outstanding"],
  rows: Array.from({ length }, (_, index) => ({
    id: `ROW-${index}`,
    doctype: "Stock Entry",
    document: `SE/${index},1`,
    stock_qty: index,
    notes: "<script>明文</script>\n详细备注",
    has_outstanding: false,
  })),
});
describe("shared native report table", () => {
  it("keeps preview title, status and date columns readable inside the table scroller", () => {
    const wrapper = mount(ReportTable, {
      props: {
        table: {
          id: "activity-metadata",
          label: "活动资料",
          columns: ["title", "status", "start_date", "end_date"],
          rows: [
            {
              id: "ACT-1",
              title: "春季法会物资筹备",
              status: "Active",
              start_date: "2026-10-21",
              end_date: "2026-10-22",
            },
          ],
        },
      },
    });
    const headers = wrapper.findAll("thead th");
    expect(headers.map((header) => header.element.style.minWidth)).toEqual([
      "12em",
      "7em",
      "10em",
      "10em",
    ]);
    expect(wrapper.get(".data-table-scroll").element).toBeTruthy();
    wrapper.unmount();
  });

  it("shows a quantity unit only while its matching unit column is hidden", () => {
    const row = {
      id: "UNIT-ROW",
      entered_qty: 2,
      entered_uom: "Box",
      stock_qty: 4,
      stock_uom: "Nos",
    };
    const hiddenUnits = mount(ReportTable, {
      props: {
        table: {
          id: "hidden-units",
          label: "单位列隐藏",
          columns: ["entered_qty", "stock_qty"],
          rows: [row],
        },
      },
    });
    expect(hiddenUnits.get("tbody").text()).toContain("2 Box");
    expect(hiddenUnits.get("tbody").text()).toContain("4 Nos");
    hiddenUnits.unmount();

    const visibleUnits = mount(ReportTable, {
      props: {
        table: {
          id: "visible-units",
          label: "单位列可见",
          columns: ["entered_qty", "entered_uom", "stock_qty", "stock_uom"],
          rows: [row],
        },
      },
    });
    const cells = visibleUnits.get("tbody").findAll("td");
    expect(cells.map((cell) => cell.text())).toEqual(["2", "Box", "4", "Nos"]);
    expect(
      visibleUnits
        .findAll("thead th")
        .map((header) => header.element.style.minWidth),
    ).toEqual(["", "8em", "135px", "8em"]);
    visibleUnits.unmount();
  });

  it("uses presentation labels and excludes raw image metadata from grouped leaf headers", () => {
    const wrapper = mount(ReportTable, {
      props: {
        table: {
          id: "curated-leaves",
          label: "分组明细",
          columns: [],
          rows: [],
        },
        grouped: true,
        groupPages: {
          entries: ref([]),
          leafColumns: ref([
            "category",
            "stock_qty",
            "stock_uom",
            "image",
            "batch_tracked",
          ]),
          pages: ref({}),
          hasMore: () => false,
          loadMore: () => {},
          toggleGroup: () => {},
          retry: () => {},
        } as never,
      },
    });
    expect(wrapper.findAll("thead th").map((cell) => cell.text())).toEqual([
      "类别",
      "库存数量",
      "库存单位",
    ]);
    expect(wrapper.find("thead").text()).not.toContain("image");
    expect(wrapper.find("thead").text()).not.toContain("batch_tracked");
    wrapper.unmount();
  });

  it("leaves absent table cells empty while retaining zero and false values", () => {
    const wrapper = mount(ReportTable, {
      props: {
        table: {
          id: "empty-values",
          label: "空值和零值",
          columns: ["missing", "stock_qty", "has_outstanding"],
          rows: [
            {
              id: "ROW-1",
              missing: null,
              stock_qty: 0,
              has_outstanding: false,
            },
          ],
        },
      },
    });
    expect(wrapper.findAll("tbody td").map((cell) => cell.text())).toEqual([
      "",
      "0",
      "否",
    ]);
    wrapper.unmount();
  });

  it("leaves absent lifecycle values blank and colors available-stock quantities by signed effect", () => {
    const wrapper = mount(ReportTable, {
      props: {
        table: {
          id: "effects",
          label: "库存变化",
          columns: ["docstatus", "stock_qty", "available_effect"],
          rows: [
            {
              id: "missing",
              docstatus: null,
              stock_qty: null,
              available_effect: null,
            },
            {
              id: "increase",
              docstatus: 1,
              stock_qty: 3,
              available_effect: 3,
              stock_uom: "Nos",
            },
            {
              id: "cancelled",
              docstatus: 2,
              stock_qty: 3,
              available_effect: 0,
              stock_uom: "Nos",
            },
          ],
        },
      },
    });
    expect(
      wrapper
        .findAll("tbody tr")[0]
        ?.findAll("td")
        .map((cell) => cell.text()),
    ).toEqual(["状态未知", "", ""]);
    expect(
      wrapper.findAll("tbody tr")[1]?.findAll("td")[1]?.find("span").classes(),
    ).toContain("is-increase");
    expect(
      wrapper.findAll("tbody tr")[2]?.findAll("td")[1]?.find("span").classes(),
    ).toContain("is-neutral");
    wrapper.unmount();
  });

  it("shows complete/local counts and reveals fixture pages without dropping rows", async () => {
    const wrapper = mount(ReportTable, { props: { table: table() } });
    expect(wrapper.findAll("tbody tr")).toHaveLength(30);
    expect(wrapper.get("caption").text()).toContain("65 行完整结果");
    expect(
      wrapper
        .findAll("button")
        .find((button) => button.text().startsWith("加载更多"))
        ?.text(),
    ).toContain("30 / 65");
    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("加载更多"))!
      .trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(60);
    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("加载更多"))!
      .trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(65);
    wrapper.unmount();
  });
  it("requests server pagination and retry while retaining already loaded native rows", async () => {
    const wrapper = mount(ReportTable, {
      props: { table: table(30), total: 500, error: "网络中断", stale: true },
    });
    expect(wrapper.get("caption").text()).toContain("500 行完整结果");
    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("加载更多"))!
      .trigger("click");
    expect(wrapper.emitted("loadMore")).toHaveLength(1);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重试加载")!
      .trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    await wrapper.setProps({ loading: true, initialized: true });
    expect(wrapper.findAll("tbody tr")).toHaveLength(30);
    expect(wrapper.find('[role="status"]').text()).toContain("保留当前结果");
    wrapper.unmount();
  });
  it("renders selectable safe text, explicit booleans and native document drill-through", async () => {
    const wrapper = mount(ReportTable, { props: { table: table(1) } });
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>明文</script>");
    expect(wrapper.text()).toContain("否");
    expect(wrapper.get("tbody tr").attributes("data-browse-row")).toBe(
      "records:ROW-0",
    );
    await wrapper.get("tbody button").trigger("click");
    expect(wrapper.emitted("openDocument")).toEqual([
      ["Stock Entry", "SE/0,1"],
    ]);
    wrapper.unmount();
  });
  it("limits a quick preview to five rows without offering pagination or changing complete count", () => {
    const wrapper = mount(ReportTable, {
      props: { table: table(30), limit: 5, total: 500 },
    });
    expect(wrapper.findAll("tbody tr")).toHaveLength(5);
    expect(wrapper.text()).toContain("500 行完整结果");
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text().startsWith("加载更多")),
    ).toBe(false);
    wrapper.unmount();
  });

  it("summarizes grouped native quantities by unit and omits meaningless zero totals", () => {
    const groupPages = {
      entries: ref([
        {
          kind: "group",
          id: "movement-root",
          label: "入库",
          depth: 1,
          count: 2,
          countLabel: "原生单据",
          expanded: true,
          hasChildren: true,
          value: {
            stock_uom: "Nos",
            stock_qty: 0,
            display_count: 2,
            count_label: "原生单据",
            quantity_breakdown: [
              { kind: "Receive", docstatus: 1, stock_qty: 5 },
              { kind: "Issue", docstatus: 1, stock_qty: 3, stock_uom: "kg" },
            ],
          },
        },
        {
          kind: "group",
          id: "loan-root",
          label: "借用",
          depth: 1,
          count: 1,
          countLabel: "分配行",
          expanded: true,
          hasChildren: true,
          value: {
            stock_uom: "kg",
            borrowed: 8,
            returned: 3,
            outstanding: 5,
            stock_qty: 0,
            item_count: 1,
          },
        },
      ]),
      pages: ref({}),
      hasMore: () => false,
      loadMore: () => {},
      toggleGroup: () => {},
      retry: () => {},
    } as never;
    const wrapper = mount(ReportTable, {
      props: {
        table: { id: "groups", label: "分组", columns: [], rows: [] },
        grouped: true,
        groupPages,
      },
    });
    const text = wrapper.text();
    expect(text).toContain("入库（已提交） 5 Nos");
    expect(text).toContain("出库（已提交） 3 kg");
    expect(text).toContain("借出量 8 kg");
    expect(text).toContain("正常归还量 3 kg");
    expect(text).toContain("未归还量 5 kg");
    expect(text).not.toContain("库存数量 0");
    wrapper.unmount();
  });
});
