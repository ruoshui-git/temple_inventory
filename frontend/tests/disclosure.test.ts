// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import DisclosureIcon from "../src/components/ui/DisclosureIcon.vue";
import DisclosureSection from "../src/components/ui/DisclosureSection.vue";

const wrappers: VueWrapper[] = [];

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("disclosure primitives", () => {
  it("toggles DisclosureSection and keeps v-model in sync", async () => {
    const Harness = defineComponent({
      setup() {
        const open = ref(false);
        return () =>
          h("div", [
            h(
              "button",
              { onClick: () => (open.value = true) },
              "open externally",
            ),
            h(
              DisclosureSection,
              {
                title: "附件",
                open: open.value,
                "onUpdate:open": (value: boolean) => (open.value = value),
              },
              { default: () => h("p", "内容") },
            ),
          ]);
      },
    });
    const wrapper = mount(Harness);
    wrappers.push(wrapper);
    const details = wrapper.get("details");
    expect((details.element as HTMLDetailsElement).open).toBe(false);
    await wrapper.get("button").trigger("click");
    await nextTick();
    expect((details.element as HTMLDetailsElement).open).toBe(true);
    await wrapper.get("summary").trigger("click");
    await nextTick();
    expect((details.element as HTMLDetailsElement).open).toBe(false);
  });

  it("keeps blank action-area clicks from toggling without cancelling control defaults", async () => {
    const wrapper = mount(DisclosureSection, {
      props: { title: "附件" },
      slots: { actions: '<a href="#files">查看</a>' },
    });
    wrappers.push(wrapper);
    const details = wrapper.get("details");
    const blank = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get(".ti-disclosure-section-actions").element.dispatchEvent(blank);
    expect(blank.defaultPrevented).toBe(true);
    expect((details.element as HTMLDetailsElement).open).toBe(false);
    const link = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get(".ti-disclosure-section-actions a").element.dispatchEvent(link);
    expect(link.defaultPrevented).toBe(false);
  });

  it("renders one stable SVG without swapping glyphs when expanded", async () => {
    const Harness = defineComponent({
      setup() {
        const open = ref(false);
        return () =>
          h(
            "button",
            {
              "aria-expanded": String(open.value),
              onClick: () => (open.value = !open.value),
            },
            [h(DisclosureIcon, { variant: "inline" })],
          );
      },
    });
    const wrapper = mount(Harness);
    wrappers.push(wrapper);
    expect(wrapper.findAll("svg")).toHaveLength(1);
    const path = wrapper.find("path").attributes("d");
    expect(path).toBe("m9 6 6 6-6 6");
    await wrapper.get("button").trigger("click");
    expect(wrapper.findAll("svg")).toHaveLength(1);
    expect(wrapper.find("path").attributes("d")).toBe(path);
    expect(wrapper.text()).toBe("");
  });
});
