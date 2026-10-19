import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RecoverySummary from "../src/components/ui/RecoverySummary.vue";

describe("recovery summary", () => {
  it("labels values without collapsing blank, zero, false, or negative quantities", () => {
    const wrapper = mount(RecoverySummary, {
      props: {
        kind: "Stock Reconciliation",
        copyText: '{"actual_qty":0,"disabled":false}',
        values: {
          item_code: "A",
          actual_qty: 0,
          disabled: false,
          notes: "",
          items: [],
          ti_count_review: [
            {
              item_code: "A",
              stock_uom: "Nos",
              baseline_qty: -2,
              actual_qty: 0,
              review_state: "Not Found",
            },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain("物品编号");
    expect(wrapper.text()).toContain("实点数量");
    expect(wrapper.text()).toContain("-2");
    expect(wrapper.text()).toContain("0");
    expect(wrapper.text()).toContain("否");
    expect(wrapper.text()).toContain("未填写");
    expect(wrapper.text()).toContain("库存单位");
    expect(wrapper.text()).toContain("Nos");
    expect(wrapper.text()).toContain("未找到");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });
  it("copies the exact supplied recovery payload and exposes exact selectable fallback on failure", async () => {
    const text = '{"unknown":"retained","zero":0}';
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const wrapper = mount(RecoverySummary, {
      props: { kind: "Item", values: { item_code: "A" }, copyText: text },
    });
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      text,
    );
    expect(wrapper.get("textarea").attributes("readonly")).toBeDefined();
  });

  it("uses product labels for saved enum values", () => {
    const wrapper = mount(RecoverySummary, {
      props: {
        kind: "Stock Entry",
        copyText: "{}",
        values: {
          ti_movement_kind: "Loan",
          ti_time_mode: "Manual",
          status: "Archived",
        },
      },
    });
    expect(wrapper.text()).toContain("借用");
    expect(wrapper.text()).toContain("手动指定");
    expect(wrapper.text()).toContain("已归档");
    expect(wrapper.text()).not.toContain("Manual");
    expect(wrapper.text()).not.toContain("Loan");
  });
});
