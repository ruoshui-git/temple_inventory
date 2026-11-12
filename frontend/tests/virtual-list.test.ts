// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import VirtualList from "../src/components/ui/VirtualList.vue";

const keys = Array.from({ length: 240 }, (_, index) => `row-${index}`);

describe("VirtualList", () => {
  it("keeps quantity input tab order and retains focused rows across scrolling", async () => {
    const page = defineComponent({
      setup() {
        return () =>
          h(
            VirtualList,
            { keys, threshold: 20, estimate: 40, tabThrough: ".qty" },
            {
              default: ({ index }: { index: number }) =>
                h("input", { class: "qty", "data-row": index }),
            },
          );
      },
    });
    const wrapper = mount(page);
    const list = wrapper.findComponent(VirtualList);
    expect(wrapper.findAll("input.qty").length).toBeLessThan(30);
    const first = wrapper.get('input[data-row="0"]');
    const focus = vi
      .spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(() => {});
    (first.element as HTMLInputElement).focus();
    first.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await flushPromises();
    expect(focus.mock.instances.at(-1)).toBe(
      wrapper.get('input[data-row="1"]').element,
    );
    wrapper.get('input[data-row="1"]').trigger("focusin");
    await (
      list.vm as unknown as { scrollToIndex: (index: number) => Promise<void> }
    ).scrollToIndex(180);
    await nextTick();
    expect(wrapper.find('input[data-row="1"]').exists()).toBe(true);
    expect(focus.mock.instances.at(-1)).toBe(
      wrapper.get('input[data-row="1"]').element,
    );
    wrapper.unmount();
  });

  it("renders a window while preserving selection state outside the mounted rows", async () => {
    const selected = ref(new Set<string>());
    const page = defineComponent({
      setup() {
        return () =>
          h(
            VirtualList,
            { keys, threshold: 20, estimate: 40 },
            {
              default: ({ index }: { index: number }) =>
                h(
                  "button",
                  {
                    "data-row": index,
                    "aria-pressed": selected.value.has(keys[index]!),
                    onClick: () => selected.value.add(keys[index]!),
                  },
                  keys[index],
                ),
            },
          );
      },
    });
    const wrapper = mount(page);
    wrapper.get('button[data-row="0"]').trigger("click");
    const list = wrapper.findComponent(VirtualList);
    await (
      list.vm as unknown as { scrollToIndex: (index: number) => Promise<void> }
    ).scrollToIndex(180);
    await nextTick();
    expect(wrapper.find('button[data-row="180"]').exists()).toBe(true);
    expect(selected.value.has("row-0")).toBe(true);
    expect(wrapper.findAll("button").length).toBeLessThan(30);
    wrapper.unmount();
  });
});
