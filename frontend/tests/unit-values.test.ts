// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import UnitValues from "../src/components/ui/UnitValues.vue";
import { setUnitSource } from "../src/lib/units";

describe("UnitValues", () => {
  afterEach(() => setUnitSource(undefined));

  it("shows ranked values, signed values, and a complete overflow disclosure", () => {
    setUnitSource({
      units: ["Nos", "Box", "Set"].map((name) => ({ name, label: name })),
    });
    const wrapper = mount(UnitValues, {
      props: {
        entries: [
          { uom: "Set", qty: 3 },
          { uom: "Box", qty: -2 },
          { uom: "Nos", qty: 4 },
        ],
        signed: true,
        label: "可用变化",
      },
    });

    expect(wrapper.text()).toContain("+4 Nos");
    expect(wrapper.text()).toContain("−2 Box");
    expect(wrapper.text()).toContain("+1 单位");
    expect(wrapper.attributes("aria-label")).toBe(
      "可用变化：+4 Nos；−2 Box；+3 Set",
    );
    expect(wrapper.attributes("title")).toBe("+4 Nos；−2 Box；+3 Set");
  });
});
