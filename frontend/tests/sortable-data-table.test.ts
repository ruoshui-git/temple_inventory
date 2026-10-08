import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import SortableDataTable, {
  type DataTableColumn,
} from "../src/components/SortableDataTable.vue";

const columns: DataTableColumn[] = [
  { key: "name", label: "名称", sortable: true, initialOrder: "desc" },
  { key: "status", label: "状态", sortable: true },
];
const rows = [{ id: "1", name: "一号", status: "开放" }];
const mountTable = (
  selectionMode = false,
  surface: "desktop" | "mobile" = "desktop",
) =>
  mount(SortableDataTable, {
    props: {
      rows,
      columns,
      rowKey: "id",
      sort: { sort_by: "status", sort_order: "asc" },
      selectionMode,
      surface,
    },
    slots: {
      "cell-name": ({ row }: any) =>
        h("a", { "data-row-action": true, href: `/item/${row.id}` }, row.name),
      "cell-status": () => h("button", { "data-row-control": true }, "按钮"),
      "mobile-row": ({ row }: any) =>
        h("article", { tabindex: 0 }, [
          h(
            "a",
            { "data-row-action": true, href: `/item/${row.id}` },
            row.name,
          ),
          h("button", { "data-row-control": true }, "按钮"),
        ]),
    },
  });

describe("SortableDataTable", () => {
  it("emits initial order, reverses active order, and exposes aria sort and arrows", async () => {
    const wrapper = mountTable();
    const headers = wrapper.findAll("th");
    await headers[0].find("button").trigger("click");
    expect(wrapper.emitted("sort")?.[0]).toEqual([
      { sort_by: "name", sort_order: "desc" },
    ]);
    expect(headers[1].attributes("aria-sort")).toBe("ascending");
    expect(headers[1].text()).toContain("↑");
    await headers[1].find("button").trigger("click");
    expect(wrapper.emitted("sort")?.[1]).toEqual([
      { sort_by: "status", sort_order: "desc" },
    ]);
  });

  it("isolates explicit controls, activates rows by keyboard, and toggles row actions in selection mode", async () => {
    const wrapper = mountTable();
    const row = wrapper.find("tbody tr");
    await row.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("activate")).toHaveLength(1);
    await row.find("[data-row-control]").trigger("click");
    expect(wrapper.emitted("activate")).toHaveLength(1);

    const selected = mountTable(true);
    await selected.find("tbody tr").find("[data-row-action]").trigger("click");
    expect(selected.emitted("toggle")).toHaveLength(1);
    await selected.find("tbody tr").find("[data-row-control]").trigger("click");
    expect(selected.emitted("toggle")).toHaveLength(1);
  });

  it("activates the supplied mobile card through its non-control area", async () => {
    const wrapper = mountTable(false, "mobile");
    const card = wrapper.find(".sortable-data-table-mobile article");
    await card.trigger("click");
    expect(wrapper.emitted("activate")).toHaveLength(1);
    await card.trigger("keydown", { key: " " });
    expect(wrapper.emitted("activate")).toHaveLength(2);
  });

  it("marks a selected supplied mobile card at the shared row boundary", () => {
    const wrapper = mount(SortableDataTable, {
      props: {
        rows,
        columns,
        rowKey: "id",
        sort: { sort_by: "status", sort_order: "asc" },
        selectionMode: true,
        selectedKeys: ["1"],
        surface: "mobile",
      },
      slots: { "mobile-row": () => h("article", { tabindex: 0 }, "一号") },
    });
    expect(wrapper.get(".sortable-mobile-row").classes()).toContain("selected");
  });

  it("exposes sticky header and primary-cell hooks without changing row contracts", () => {
    const wrapper = mount(SortableDataTable, {
      props: {
        rows,
        columns,
        rowKey: "id",
        sort: { sort_by: "status", sort_order: "asc" },
        surface: "desktop",
      },
      slots: {
        "cell-name": () =>
          h("div", { class: "primary-cell" }, [
            h("span", { class: "primary-text" }, "一号"),
            h("small", { class: "secondary-text" }, "1"),
          ]),
      },
    });
    expect(wrapper.find("thead").classes()).toContain(
      "sortable-data-table-head",
    );
    expect(wrapper.find(".primary-cell .primary-text").text()).toBe("一号");
    expect(wrapper.find(".primary-cell .secondary-text").text()).toBe("1");
  });

  it("keeps rows visible during refresh and exposes distinct initial/append states", () => {
    const refreshing = mount(SortableDataTable, {
      props: {
        rows,
        columns,
        rowKey: "id",
        sort: { sort_by: "status", sort_order: "asc" },
        loading: true,
        loadingMore: true,
        surface: "desktop",
      },
    });
    expect(refreshing.find("tbody tr").text()).toContain("一号");
    expect(refreshing.find(".table-refresh-overlay").text()).toContain(
      "正在更新",
    );
    expect(refreshing.attributes("aria-busy")).toBe("true");

    const initial = mount(SortableDataTable, {
      props: {
        rows: [],
        columns,
        rowKey: "id",
        sort: { sort_by: "status", sort_order: "asc" },
        loading: true,
        surface: "desktop",
      },
    });
    expect(initial.text()).toContain("正在加载记录");
    expect(initial.text()).not.toContain("暂无记录");
    expect(initial.find(".table-skeleton").exists()).toBe(true);
  });

  it("shows the empty state only after loading finishes", () => {
    const wrapper = mount(SortableDataTable, {
      props: {
        rows: [],
        columns,
        rowKey: "id",
        sort: { sort_by: "status", sort_order: "asc" },
        loading: false,
        surface: "mobile",
      },
    });
    expect(wrapper.text()).toContain("暂无记录");
    expect(wrapper.attributes("aria-busy")).toBe("false");
  });

  it("keeps mobile rows visible alongside a refresh error", () => {
    const wrapper = mount(SortableDataTable, {
      props: {
        rows,
        columns,
        rowKey: "id",
        sort: { sort_by: "status", sort_order: "asc" },
        surface: "mobile",
        error: "更新失败",
      },
    });
    expect(wrapper.find(".sortable-mobile-row").exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain("更新失败");
  });
});
