// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import InventoryIcon from "../src/components/InventoryIcon.vue";
import DataTable from "../src/components/ui/DataTable.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

const glyphs = {
  none: "M8 7l4-4 4 4M12 3v18m-4-4 4 4 4-4",
  asc: "M8 7l4-4 4 4M12 3v18",
  desc: "M8 17l4 4 4-4M12 3v18",
};

describe("InventoryIcon reactivity", () => {
  it("re-renders the glyph when the name prop changes", async () => {
    const wrapper = mount(InventoryIcon, { props: { name: "sort-none" } });
    wrappers.push(wrapper);
    expect(wrapper.get("path").attributes("d")).toBe(glyphs.none);
    await wrapper.setProps({ name: "sort-asc" });
    expect(wrapper.get("path").attributes("d")).toBe(glyphs.asc);
    await wrapper.setProps({ name: "sort-desc" });
    expect(wrapper.get("path").attributes("d")).toBe(glyphs.desc);
  });

  it("resolves aliases on every prop change", async () => {
    const wrapper = mount(InventoryIcon, { props: { name: "box" } });
    wrappers.push(wrapper);
    await wrapper.setProps({ name: "trash" });
    const disposal = wrapper.get("path").attributes("d");
    expect(disposal).toBeTruthy();
    expect(disposal).not.toBe(glyphs.none);
    await wrapper.setProps({ name: "info" });
    expect(wrapper.get("path").attributes("d")).not.toBe(disposal);
  });
});

describe("DataTable sort indicator", () => {
  const columns = [
    { id: "item", label: "物品", sortable: true },
    { id: "quantity", label: "数量", sortable: true },
  ];

  it("shows none, asc and desc glyphs as the sort props change", async () => {
    const wrapper = mount(DataTable, {
      props: { ariaLabel: "排序表格", columns, rows: [] },
    });
    wrappers.push(wrapper);
    const indicatorPath = () =>
      wrapper
        .get('[aria-label="物品排序：未排序"] .data-table-sort-indicator path')
        .attributes("d");
    expect(indicatorPath()).toBe(glyphs.none);

    await wrapper.setProps({ sortBy: "item", sortDirection: "asc" });
    expect(
      wrapper
        .get('[aria-label="物品排序：升序"] .data-table-sort-indicator path')
        .attributes("d"),
    ).toBe(glyphs.asc);

    await wrapper.setProps({ sortDirection: "desc" });
    expect(
      wrapper
        .get('[aria-label="物品排序：降序"] .data-table-sort-indicator path')
        .attributes("d"),
    ).toBe(glyphs.desc);

    await wrapper.setProps({ sortBy: "quantity", sortDirection: "asc" });
    expect(
      wrapper
        .get('[aria-label="物品排序：未排序"] .data-table-sort-indicator path')
        .attributes("d"),
    ).toBe(glyphs.none);
    expect(
      wrapper
        .get('[aria-label="数量排序：升序"] .data-table-sort-indicator path')
        .attributes("d"),
    ).toBe(glyphs.asc);
  });
});
