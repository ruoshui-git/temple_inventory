import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import RecoverySummary from "../src/components/ui/RecoverySummary.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";

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
              review_state: "Reviewed",
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
    expect(wrapper.text()).toContain("已核对");
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

  it.each([
    ["Item", "recovery-summary.item"],
    ["Stock Reconciliation", "recovery-summary.stock-reconciliation"],
  ])(
    "uses a valid stable table preference ID for %s without changing recovery input",
    async (kind, expectedTableId) => {
      const values =
        kind === "Item"
          ? { item_code: "A", items: [{ item_code: "A", qty: 0 }] }
          : {
              ti_count_review: [
                { item_code: "A", actual_qty: 2, reason: "counted" },
              ],
            };
      const originalValues = structuredClone(values);
      const reference = createReferenceData();
      reference.user = "test-user";
      reference.site = "test-site";
      const call = vi.fn(async () => ({}));
      const services: InventoryServices = {
        call,
        report: vi.fn(),
        upload: vi.fn(),
      };
      const Host = defineComponent({
        setup() {
          provideInventoryServices(services, reference);
          return () =>
            h(RecoverySummary, {
              kind,
              values,
              copyText: JSON.stringify(values),
            });
        },
      });

      mount(Host);
      await flushPromises();

      expect(call).toHaveBeenCalledWith(
        "table_preferences.get_column_preferences",
        {
          table_id: expectedTableId,
        },
      );
      expect(expectedTableId).toMatch(/^[a-z0-9][a-z0-9._:-]{0,119}$/);
      expect(values).toEqual(originalValues);
    },
  );
});
