import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import OverflowActionMenu from "../src/components/OverflowActionMenu.vue";

const actions = [
  { kind: "Receive", label: "入库" },
  { kind: "Issue", label: "出库" },
  { kind: "Transfer", label: "转移" },
  { kind: "Export", label: "导出" },
];

describe("OverflowActionMenu", () => {
  it("supports Escape, arrow/Home/End navigation, focus return, and outside close", async () => {
    const wrapper = mount(OverflowActionMenu, {
      attachTo: document.body,
      props: { actions },
    });
    const trigger = wrapper.find<HTMLButtonElement>(".overflow-action-trigger");
    expect(trigger.classes()).toContain("overflow-action-trigger");
    expect(trigger.element.style.width).toBe("");
    await trigger.trigger("click");
    await flushPromises();
    const items = wrapper.findAll<HTMLButtonElement>('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0].element);
    await items[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1].element);
    await items[1].trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(items[3].element);
    await items[3].trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(items[0].element);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
