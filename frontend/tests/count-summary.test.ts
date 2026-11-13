// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import CountSummary from "../src/features/counts/CountSummary.vue";
import type { CountRow } from "../src/features/counts/countModel";

const row = (code: string, actual: number | null): CountRow => ({
  item_code: code,
  warehouse: "ROOM",
  batch_no: null,
  stock_uom: "Nos",
  baseline_qty: 2,
  actual_qty: actual,
  review_state: actual === null ? "Unreviewed" : "Reviewed",
  reason: "",
});

describe("phone count summary", () => {
  it("collapses progress to one live status line, expands to tiles, and stays open as rows change", async () => {
    const rows = reactive([row("A", 3), row("B", null)]);
    const Host = defineComponent({
      setup: () => () => h(CountSummary, { rows, mobile: true }),
    });
    const wrapper = mount(Host);
    const details = wrapper.get("details");
    expect(details.attributes("open")).toBeUndefined();
    expect(details.get("summary").text()).toContain(
      "已核对 1/2 · 未核对 1 · 差异 1",
    );
    (details.element as HTMLDetailsElement).open = true;
    expect(wrapper.get("details").attributes("open")).toBeDefined();
    expect(wrapper.findAll("article")).toHaveLength(6);
    rows[1] = row("B", 2);
    await wrapper.vm.$nextTick();
    expect(wrapper.get("details").attributes("open")).toBeDefined();
    expect(wrapper.get("summary").text()).toContain("已核对 2/2 · 差异 1");
    expect(wrapper.get('[role="status"]').text()).toContain("已核对 2/2");
  });

  it("keeps the desktop tile summary", () => {
    const wrapper = mount(CountSummary, { props: { rows: [row("A", null)] } });
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.findAll("article")).toHaveLength(6);
  });
});
