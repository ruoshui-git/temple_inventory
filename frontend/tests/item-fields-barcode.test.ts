import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import ItemFields from "../src/features/items/ItemFields.vue";
import type { ItemInput } from "../src/features/items/useItemEditor";

const model = (): ItemInput => ({
  code: "A",
  name: "Item",
  category: "",
  uom: "Nos",
  barcode: "0001",
  description: "",
  tracksBatch: false,
  tracksExpiry: false,
});
const OverlayStub = defineComponent({
  props: ["title", "adaptiveCreation"],
  emits: ["close"],
  setup(_, { slots, emit }) {
    return () =>
      h("section", { "data-overlay": "contextual" }, [
        slots.default?.(),
        h(
          "button",
          { class: "cancel", onClick: () => emit("close") },
          "Cancel",
        ),
      ]);
  },
});
const ScannerStub = defineComponent({
  props: ["paused", "presentation", "submitLabel"],
  emits: ["scan", "close"],
  setup(_, { emit }) {
    return () =>
      h("div", { class: "scanner" }, [
        h(
          "button",
          { class: "scan", onClick: () => emit("scan", "  00AbC ") },
          "scan",
        ),
        h(
          "button",
          { class: "scanner-cancel", onClick: () => emit("close") },
          "cancel",
        ),
      ]);
  },
});

describe("ItemFields barcode scanner", () => {
  it("opens the contextual scanner, appends a trimmed raw code once, and closes on scan/cancel", async () => {
    const wrapper = mount(ItemFields, {
      props: { model: model(), editorTarget: document.body },
      global: {
        stubs: {
          Overlay: OverlayStub,
          Scanner: ScannerStub,
          CategoryField: true,
          UnitField: true,
        },
      },
    });
    await wrapper.get("button").trigger("click");
    expect(wrapper.find("[data-overlay=contextual]").exists()).toBe(true);
    expect(wrapper.findComponent(OverlayStub).exists()).toBe(true);
    await wrapper.get(".scan").trigger("click");
    expect((wrapper.props("model") as ItemInput).barcode).toBe("0001\n00AbC");
    expect(wrapper.find(".scanner").exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    await wrapper.get(".scan").trigger("click");
    expect((wrapper.props("model") as ItemInput).barcode).toBe("0001\n00AbC");
    await wrapper.get("button").trigger("click");
    await wrapper.get(".cancel").trigger("click");
    expect(wrapper.find(".scanner").exists()).toBe(false);
  });

  it("does not append while disabled and closes an open scanner when disabled", async () => {
    const value = model();
    const wrapper = mount(ItemFields, {
      props: { model: value },
      global: {
        stubs: {
          Overlay: OverlayStub,
          Scanner: ScannerStub,
          CategoryField: true,
          UnitField: true,
        },
      },
    });
    await wrapper.get("button").trigger("click");
    await wrapper.setProps({ disabled: true });
    expect(wrapper.find(".scanner").exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    expect(wrapper.find(".scanner").exists()).toBe(false);
    expect(value.barcode).toBe("0001");
    wrapper.unmount();
  });
});
