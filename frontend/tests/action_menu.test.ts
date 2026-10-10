import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ActiveFilterChips from "../src/components/ActiveFilterChips.vue";
import FloatingActionMenu from "../src/components/FloatingActionMenu.vue";

describe("browse action contracts", () => {
  it("keeps chip removal at the beginning and collapses overflow", async () => {
    const chips = Array.from({ length: 8 }, (_, index) => ({
      key: "warehouse",
      value: String(index),
      label: `位置${index}`,
    }));
    const wrapper = mount(ActiveFilterChips, { props: { chips } });
    expect(wrapper.find(".filter-chip button").text()).toBe("×");
    expect(wrapper.find(".chip-overflow").text()).toContain("另有 2 项");
    await wrapper.find(".chip-overflow").trigger("click");
    expect(wrapper.findAll(".filter-chip")).toHaveLength(8);
    expect(wrapper.find(".chip-overflow").text()).toBe("收起");
  });

  it("can hide the page-level clear action without changing the default", () => {
    const chips = [{ key: "warehouse", value: "hall", label: "大殿" }];
    const defaultWrapper = mount(ActiveFilterChips, { props: { chips } });
    const compactWrapper = mount(ActiveFilterChips, {
      props: { chips, showClear: false },
    });
    expect(defaultWrapper.find(".clear-filters").exists()).toBe(true);
    expect(compactWrapper.find(".filter-chip").text()).toContain("大殿");
    expect(compactWrapper.find(".clear-filters").exists()).toBe(false);
  });

  it("does not start an action while closed and closes on Escape", async () => {
    const wrapper = mount(FloatingActionMenu, {
      props: { actions: [{ kind: "Receive", label: "入库" }] },
    });
    expect(wrapper.emitted("select")).toBeUndefined();
    await wrapper.find(".action-fab").trigger("click");
    await wrapper.find('[role="menuitem"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["Receive"]]);
    await wrapper.find(".action-fab").trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it("supports cyclic arrow-key navigation and restores the FAB after choosing", async () => {
    const wrapper = mount(FloatingActionMenu, {
      attachTo: document.body,
      props: {
        actions: [
          { kind: "Receive", label: "入库" },
          { kind: "Issue", label: "出库" },
        ],
      },
    });
    await wrapper.find(".action-fab").trigger("click");
    const actions = wrapper.findAll<HTMLButtonElement>('[role="menuitem"]');
    await actions[0].trigger("focus");
    await actions[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(actions[1].element);
    await actions[1].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(actions[0].element);
    await actions[0].trigger("click");
    expect(document.activeElement).toBe(wrapper.find(".action-fab").element);
    wrapper.unmount();
  });

  it("does not open or emit when the trigger and menu actions are disabled", async () => {
    const wrapper = mount(FloatingActionMenu, {
      props: {
        actions: [
          { kind: "Receive", label: "入库", disabled: true },
          { kind: "Issue", label: "出库", loading: true },
        ],
      },
    });
    const trigger = wrapper.find<HTMLButtonElement>(".action-fab");
    expect(trigger.attributes("disabled")).toBeDefined();
    await trigger.trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("skips disabled menu items during keyboard navigation", async () => {
    const wrapper = mount(FloatingActionMenu, {
      props: {
        actions: [
          { kind: "Receive", label: "入库" },
          { kind: "Issue", label: "出库", disabled: true },
          { kind: "Transfer", label: "转移" },
        ],
      },
      attachTo: document.body,
    });
    await wrapper.find(".action-fab").trigger("click");
    const actions = wrapper.findAll<HTMLButtonElement>('[role="menuitem"]');
    await actions[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(actions[2].element);
    await actions[2].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(actions[0].element);
    wrapper.unmount();
  });
});
