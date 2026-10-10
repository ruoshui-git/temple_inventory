import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import CategorySelector from "../src/components/CategorySelector.vue";
import CompactFilterSection from "../src/components/CompactFilterSection.vue";
import HierarchyAutocomplete from "../src/components/HierarchyAutocomplete.vue";
import MovementLookup from "../src/components/MovementLookup.vue";
import ResponsiveFilterPanel from "../src/components/ResponsiveFilterPanel.vue";

const optionRows = [
  { name: "root", label: "仓库", is_group: 1, lft: 1, rgt: 4 },
  { name: "leaf", label: "A01", parent: "root", is_group: 0, lft: 2, rgt: 3 },
];

describe("shared compact filter primitives", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("provides shared heading, count, collapse, per-section clear, and body controls", async () => {
    const wrapper = mount(CompactFilterSection, {
      props: { title: "仓库 / 位置", count: "2 项", clearable: true },
      slots: { default: "<input aria-label='位置搜索' />" },
    });
    expect(wrapper.find(".compact-filter-section-heading").text()).toContain(
      "2 项",
    );
    expect(
      parseFloat(
        getComputedStyle(
          wrapper.find(".compact-filter-section-heading").element,
        ).margin,
      ),
    ).toBe(0);
    expect(wrapper.find("input").exists()).toBe(true);
    expect(wrapper.find(".compact-filter-section-chevron").classes()).toContain(
      "disclosure-triangle",
    );
    expect(wrapper.find(".compact-filter-section-chevron").classes()).toContain(
      "expanded",
    );
    await wrapper.find(".compact-filter-section-toggle").trigger("click");
    expect(wrapper.find(".compact-filter-section").classes()).not.toContain(
      "is-open",
    );
    expect(
      wrapper.find(".compact-filter-section-chevron").classes(),
    ).not.toContain("expanded");
    await wrapper.find(".compact-filter-section-clear").trigger("click");
    expect(wrapper.emitted("clear")).toHaveLength(1);
    await nextTick();
  });

  it("keeps one section card and heading when a hierarchy filter is embedded", () => {
    const wrapper = mount(CompactFilterSection, {
      props: { title: "物品类别" },
      slots: {
        default: h(CategorySelector, {
          modelValue: [],
          rows: optionRows.map((row) => ({
            ...row,
            item_group_name: row.label,
          })),
          embedded: true,
        }),
      },
    });
    expect(wrapper.findAll(".compact-filter-section")).toHaveLength(1);
    expect(wrapper.findAll(".hierarchy-facet")).toHaveLength(1);
    expect(wrapper.findAll(".hierarchy-facet header")).toHaveLength(0);
    expect(wrapper.findAll("h3")).toHaveLength(0);
  });

  it("closes MovementLookup on outside pointer, Escape, focus leave, and unmount", async () => {
    const wrapper = mount(MovementLookup, {
      props: { modelValue: "", options: [{ label: "物品一", value: "ITM-1" }] },
    });
    await wrapper.find("input").trigger("focus");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await wrapper.find("input").trigger("focus");
    await wrapper.find("input").trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await wrapper.find("input").trigger("focus");
    await wrapper
      .find(".movement-lookup")
      .trigger("focusout", { relatedTarget: null });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows a spinner and busy state while MovementLookup options refresh", async () => {
    const wrapper = mount(MovementLookup, {
      props: {
        modelValue: "",
        options: [{ label: "物品一", value: "ITM-1" }],
        loading: true,
      },
    });
    await wrapper.find("input").trigger("focus");
    expect(wrapper.find('[role="listbox"]').attributes("aria-busy")).toBe(
      "true",
    );
    expect(wrapper.find(".loading-spinner-small").exists()).toBe(true);
    expect(
      wrapper.find('[role="option"]').attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });

  it("keeps the warehouse/category hierarchy tree inline without a popup", async () => {
    const wrapper = mount(HierarchyAutocomplete, {
      props: {
        modelValue: [],
        title: "仓库",
        placeholder: "搜索仓库",
        options: optionRows,
        tree: optionRows,
      },
    });
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    expect(wrapper.findAll(".hierarchy-row").length).toBeGreaterThan(0);
    await wrapper
      .find("input[type='search']")
      .trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("uses one real mobile dialog surface with backdrop and focus return", async () => {
    const wrapper = mount(ResponsiveFilterPanel, {
      props: { open: false, count: 2, clearable: true },
      slots: { default: "<input aria-label='筛选条件' />" },
    });
    await wrapper.find(".filter-trigger").trigger("click");
    await wrapper.setProps({ open: true });
    await nextTick();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains("filter-drawer-open")).toBe(true);
    expect(dialog?.getAttribute("data-filter-open")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(dialog?.querySelector("input")?.getAttribute("aria-label")).toBe(
      "筛选条件",
    );
    expect(dialog?.querySelector(".filter-drawer-back")?.textContent).toContain(
      "返回",
    );
    expect(
      getComputedStyle(
        dialog?.querySelector(".filter-drawer-done") as HTMLButtonElement,
      ).display,
    ).not.toBe("none");
    (dialog?.querySelector(".filter-drawer-back") as HTMLButtonElement).click();
    await nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    await wrapper.setProps({ open: true });
    await nextTick();
    expect(document.body.querySelector(".filter-dialog-proxy")).toBeNull();
    expect(
      document.body.querySelector(".filter-drawer-backdrop"),
    ).not.toBeNull();
    (
      document.body.querySelector(".filter-drawer-backdrop") as HTMLElement
    ).click();
    await nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    await wrapper.setProps({ open: false });
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
    wrapper.unmount();
  });
});
