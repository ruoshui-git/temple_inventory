import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import HierarchyFilter from "../src/components/ui/HierarchyFilter.vue";

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

const nestedNodes = [
  { name: "root", label: "总仓", is_group: 1, lft: 1, rgt: 22 },
  { name: "room", label: "A 室", parent: "root", is_group: 1, lft: 2, rgt: 11 },
  {
    name: "shelf-group",
    label: "货架组",
    parent: "room",
    is_group: 1,
    lft: 3,
    rgt: 8,
  },
  {
    name: "shelf-a",
    label: "A-01",
    parent: "shelf-group",
    is_group: 0,
    lft: 4,
    rgt: 5,
  },
  {
    name: "shelf-b",
    label: "A-02",
    parent: "shelf-group",
    is_group: 0,
    lft: 6,
    rgt: 7,
  },
  {
    name: "room-b",
    label: "B 室",
    parent: "root",
    is_group: 1,
    lft: 12,
    rgt: 15,
  },
  {
    name: "shelf-c",
    label: "B-01",
    parent: "room-b",
    is_group: 0,
    lft: 13,
    rgt: 14,
  },
  {
    name: "empty",
    label: "空组",
    parent: "root",
    is_group: 1,
    lft: 16,
    rgt: 17,
  },
  { name: "unrelated", label: "外部", is_group: 0, lft: 23, rgt: 24 },
];

describe("HierarchyFilter", () => {
  it("keeps category roots closed and expands warehouse branches by selectable leaves only", async () => {
    const tree = [
      { name: "root", label: "仓库", is_group: 1, lft: 1, rgt: 14 },
      {
        name: "branch",
        label: "多叶分支",
        parent: "root",
        is_group: 1,
        lft: 2,
        rgt: 7,
      },
      {
        name: "leaf-a",
        label: "A",
        parent: "branch",
        is_group: 0,
        lft: 3,
        rgt: 4,
      },
      {
        name: "leaf-b",
        label: "B",
        parent: "branch",
        is_group: 0,
        lft: 5,
        rgt: 6,
      },
      {
        name: "chain",
        label: "单叶链",
        parent: "root",
        is_group: 1,
        lft: 8,
        rgt: 13,
      },
      {
        name: "chain-next",
        label: "末级前一层",
        parent: "chain",
        is_group: 1,
        lft: 9,
        rgt: 12,
      },
      {
        name: "leaf-c",
        label: "C",
        parent: "chain-next",
        is_group: 0,
        lft: 10,
        rgt: 11,
      },
    ];
    const wrapper = mount(HierarchyFilter, {
      props: {
        modelValue: [],
        options: tree,
        tree,
        placeholder: "搜索",
        title: "仓库",
        initialExpansion: "branching-leaves",
      },
    });
    expect(
      wrapper
        .findAll(".hierarchy-row")
        .map((row) => row.get("label span").text()),
    ).toEqual(["仓库", "多叶分支", "A", "B", "单叶链"]);
    expect(
      wrapper
        .get('button[aria-label="展开 单叶链"]')
        .attributes("aria-expanded"),
    ).toBe("false");

    await wrapper.get('button[aria-label="收起 仓库"]').trigger("click");
    const refreshed = [
      ...tree,
      { name: "new-leaf", parent: "root", is_group: 0 },
    ];
    await wrapper.setProps({ options: refreshed, tree: refreshed });
    expect(wrapper.findAll(".hierarchy-row")).toHaveLength(1);
    await wrapper.get('input[type="search"]').setValue("C");
    expect(
      wrapper
        .findAll(".hierarchy-row")
        .some((row) => row.get("label span").text().startsWith("C")),
    ).toBe(true);
    await wrapper.get('input[type="search"]').setValue("");
    expect(wrapper.findAll(".hierarchy-row")).toHaveLength(1);
    wrapper.unmount();

    const category = mount(HierarchyFilter, {
      props: {
        modelValue: [],
        options: tree,
        tree,
        placeholder: "搜索",
        title: "类别",
        initialExpansion: "first-level",
      },
    });
    expect(
      category
        .findAll(".hierarchy-row")
        .map((row) => row.get("label span").text()),
    ).toEqual(["仓库"]);
    await category.get('button[aria-label="展开 仓库"]').trigger("click");
    expect(
      category
        .findAll(".hierarchy-row")
        .map((row) => row.get("label span").text()),
    ).toEqual(["仓库", "多叶分支", "单叶链"]);
  });
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

  it("replaces nested selections with an ancestor and clears its whole branch", async () => {
    const wrapper = mount(HierarchyFilter, {
      props: {
        modelValue: ["shelf-group", "shelf-a", "unrelated"],
        options: nestedNodes,
        tree: nestedNodes,
        placeholder: "搜索",
        title: "仓库",
      },
    });
    await wrapper.findAll('input[type="checkbox"]')[0].trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      ["unrelated", "root"],
    ]);
    await wrapper.setProps({ modelValue: ["root", "unrelated"] });
    await wrapper.findAll('input[type="checkbox"]')[0].trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      ["unrelated"],
    ]);
  });

  it("excludes a leaf or nested group beneath a selected ancestor and keeps remaining leaves", async () => {
    const wrapper = mount(HierarchyFilter, {
      props: {
        modelValue: ["root", "unrelated"],
        options: nestedNodes,
        tree: nestedNodes,
        placeholder: "搜索",
        title: "仓库",
      },
    });
    const roomGroup = wrapper.findAll('input[type="checkbox"]')[1];
    await roomGroup.trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      ["unrelated", "shelf-c"],
    ]);
    await wrapper.setProps({ modelValue: ["root", "unrelated"] });
    await wrapper.findAll('input[type="checkbox"]')[3].trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      ["unrelated", "shelf-b", "shelf-c"],
    ]);
    await wrapper.setProps({ modelValue: ["shelf-a", "unrelated"] });
    expect(
      (wrapper.findAll('input[type="checkbox"]')[1].element as HTMLInputElement)
        .indeterminate,
    ).toBe(true);
  });

  it("keeps hidden fallback leaves in parent coverage and makes empty groups explicitly selectable", async () => {
    const tree = [
      { name: "room", label: "A 室", is_group: 1, lft: 1, rgt: 6 },
      {
        name: "visible",
        label: "可见位置",
        parent: "room",
        is_group: 0,
        lft: 2,
        rgt: 3,
      },
      {
        name: "hidden",
        label: "隐藏备用位",
        parent: "room",
        is_group: 0,
        lft: 4,
        rgt: 5,
      },
      { name: "empty", label: "空组", is_group: 1, lft: 7, rgt: 8 },
    ];
    const wrapper = mount(HierarchyFilter, {
      props: {
        modelValue: ["room"],
        options: [tree[0], tree[1], tree[3]],
        tree,
        placeholder: "搜索",
        title: "仓库",
      },
    });
    expect(
      (wrapper.findAll('input[type="checkbox"]')[2].element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.findAll('input[type="checkbox"]')[1].trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["hidden"]]);
    await wrapper.setProps({ modelValue: [] });
    expect(
      (wrapper.findAll('input[type="checkbox"]')[2].element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.findAll('input[type="checkbox"]')[2].trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["empty"]]);
  });

  it("uses nested-set bounds when parent links are absent and marks selected empty children partial", async () => {
    const tree = [
      { name: "root", label: "总仓", is_group: 1, lft: 1, rgt: 10 },
      { name: "group", label: "房间", is_group: 1, lft: 2, rgt: 7 },
      { name: "leaf-a", label: "A", is_group: 0, lft: 3, rgt: 4 },
      { name: "leaf-b", label: "B", is_group: 0, lft: 5, rgt: 6 },
      { name: "empty", label: "空组", is_group: 1, lft: 8, rgt: 9 },
    ];
    const wrapper = mount(HierarchyFilter, {
      props: {
        modelValue: ["root"],
        options: tree,
        tree,
        placeholder: "搜索",
        title: "仓库",
      },
    });
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(true);
    await checkboxes[2].trigger("change");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["leaf-b"]]);
    await wrapper.setProps({ modelValue: ["empty"] });
    expect(
      (wrapper.findAll('input[type="checkbox"]')[0].element as HTMLInputElement)
        .indeterminate,
    ).toBe(true);
    expect(
      (wrapper.findAll('input[type="checkbox"]')[4].element as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
