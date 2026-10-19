import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
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
    ).toEqual(["", "", ""]);
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
      props: { table: table(30), total: 500, error: "网络中断" },
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
    await wrapper.setProps({ loading: true });
    expect(wrapper.findAll("tbody tr")).toHaveLength(30);
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
});
