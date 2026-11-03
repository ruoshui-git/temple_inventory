// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import RowFieldsSheet from "../src/components/ui/RowFieldsSheet.vue";
import type { DataColumn } from "../src/lib/dataTable";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

const columns: DataColumn[] = [
  { id: "item_name", label: "物品名称" },
  { id: "serial", label: "序列号" },
  { id: "note", label: "备注" },
];
const row = {
  item_name: "长名称的显微镜物镜组件",
  serial: "SN-1, SN-2, SN-3, SN-4",
  note: null,
};

describe("RowFieldsSheet", () => {
  it("lists every column label and full value", () => {
    const wrapper = mount(RowFieldsSheet, {
      props: { title: "显微镜", columns, row },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const labels = Array.from(
      document.querySelectorAll(".row-fields-sheet dt"),
    ).map((dt) => dt.textContent);
    const values = Array.from(
      document.querySelectorAll(".row-fields-sheet dd"),
    ).map((dd) => dd.textContent);
    expect(labels).toEqual(["物品名称", "序列号", "备注"]);
    expect(values).toEqual([
      "长名称的显微镜物镜组件",
      "SN-1, SN-2, SN-3, SN-4",
      "—",
    ]);
  });

  it("emits open from the 打开 button", async () => {
    const wrapper = mount(RowFieldsSheet, {
      props: { title: "显微镜", columns, row },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "打开",
    );
    expect(open).toBeDefined();
    open!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("open")).toHaveLength(1);
  });
});
