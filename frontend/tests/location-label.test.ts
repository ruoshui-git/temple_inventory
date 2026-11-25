// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import LocationLabel from "../src/components/ui/LocationLabel.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("LocationLabel", () => {
  it("keeps the site segment separate and exposes the full mixed-script path", () => {
    const wrapper = mount(LocationLabel, {
      props: { label: "T2/F/A01/S1" },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".location-label-site").text()).toBe("T2/");
    expect(wrapper.find(".location-label-tail").text()).toBe("F/A01/S1");
    expect(wrapper.text().replace(/\s+/g, "")).toBe("T2/F/A01/S1");
    expect(wrapper.attributes("title")).toBeUndefined();
    expect(wrapper.attributes("data-inventory-tip")).toBe("");
    expect(wrapper.attributes("aria-label")).toBe("T2/F/A01/S1");
  });

  it("keeps Chinese site names intact", () => {
    const wrapper = mount(LocationLabel, {
      props: { label: "第二寺院/室外/前院" },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".location-label-site").text()).toBe("第二寺院/");
    expect(wrapper.attributes("aria-label")).toBe("第二寺院/室外/前院");
  });
});
