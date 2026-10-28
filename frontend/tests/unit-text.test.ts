// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import UnitText from "../src/components/ui/UnitText.vue";
import { setUnitSource } from "../src/lib/units";

describe("UnitText", () => {
  afterEach(() => setUnitSource(undefined));

  it("shows the app label and exposes the native UOM name on hover", () => {
    setUnitSource({ units: [{ name: "Nos", label: "个" }] });
    const wrapper = mount(UnitText, { props: { name: "Nos" } });
    expect(wrapper.text()).toBe("个");
    expect(wrapper.attributes("title")).toBe("Nos");
  });

  it("formats an optional quantity and omits a redundant title", () => {
    setUnitSource({ units: [{ name: "Nos", label: "Nos" }] });
    const wrapper = mount(UnitText, { props: { name: "Nos", qty: 12 } });
    expect(wrapper.text()).toBe("12 Nos");
    expect(wrapper.attributes("title")).toBeUndefined();
  });
});
