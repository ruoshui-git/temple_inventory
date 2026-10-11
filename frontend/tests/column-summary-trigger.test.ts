import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ColumnSummaryTrigger from "../src/components/ColumnSummaryTrigger.vue";

describe("column summary trigger", () => {
  it("uses one sigma icon and a visible, accessible neutral label", async () => {
    const wrapper = mount(ColumnSummaryTrigger);
    const button = wrapper.get("button");
    expect(button.text()).toBe("列汇总");
    expect(button.attributes("aria-label")).toBeUndefined();
    expect(button.find("svg").attributes("aria-hidden")).toBe("true");
    expect(button.classes()).toContain("column-summary-trigger");
    await button.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });
});
