import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import HierarchyFilter from "../src/components/HierarchyFilter.vue";

const nodes = [
  {
    name: "root",
    label: "仓库",
    is_group: 1,
    parent: "",
    lft: 1,
    rgt: 6,
    count: 4,
  },
  {
    name: "room-a",
    label: "A 室",
    parent: "root",
    is_group: 1,
    lft: 2,
    rgt: 5,
    count: 3,
  },
  {
    name: "shelf-a",
    label: "A-01",
    parent: "room-a",
    is_group: 0,
    lft: 3,
    rgt: 4,
    count: 3,
  },
];

describe("HierarchyFilter", () => {
  it("renders the inline tree immediately and supports search, selection, and clear", async () => {
    const wrapper = mount(HierarchyFilter, {
      props: {
        modelValue: [],
        options: nodes,
        tree: nodes,
        title: "仓库",
        placeholder: "搜索",
      },
    });
    expect(wrapper.find(".hierarchy-inline-tree").exists()).toBe(true);
    expect(wrapper.findAll(".hierarchy-row")).toHaveLength(3);
    expect(
      wrapper.get('button[aria-label="收起 仓库"]').attributes("aria-expanded"),
    ).toBe("true");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["root"]]);
    expect(wrapper.text()).toContain("仓库");
    await wrapper.setProps({ modelValue: ["root"] });
    await wrapper.get('input[type="search"]').setValue("A-01");
    expect(wrapper.findAll(".hierarchy-row")).toHaveLength(3);
    await wrapper.get('button[aria-label="清除本项"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([[]]);
  });
});
