// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import SerialCountChecklist from "../src/features/counts/SerialCountChecklist.vue";
import NativeCountAllocations from "../src/features/counts/NativeCountAllocations.vue";
import {
  countIssues,
  countSummary,
  serialCountDifference,
  type CountRow,
} from "../src/features/counts/countModel";

function makeRow(overrides: Partial<CountRow> = {}): CountRow {
  return {
    item_code: "SERIAL-ITEM",
    warehouse: "ROOM-A",
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: 2,
    baseline_serials: ["SER-1", "SER-2"],
    actual_serials: null,
    actual_qty: null,
    is_serial: true,
    review_state: "Unreviewed",
    reason: "",
    ...overrides,
  };
}

function mountChecklist(row: CountRow, call = vi.fn()) {
  const reference = createReferenceData();
  const updates: (string[] | null)[] = [];
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () =>
        h(SerialCountChecklist, {
          row,
          writable: true,
          busy: false,
          onUpdate: (serials: string[] | null) => updates.push(serials),
        });
    },
  });
  return { wrapper: mount(root), call, updates };
}

describe("serial count checklist", () => {
  it("marks all baseline serials present and computes set differences", async () => {
    const row = makeRow({
      actual_serials: ["SER-1"],
      actual_qty: 1,
      review_state: "Reviewed",
    });
    const { wrapper, updates } = mountChecklist(row);
    await wrapper.get("button[aria-pressed='true']").trigger("click");
    expect(updates.at(-1)).toEqual([]);
    await wrapper.get("button").trigger("click");
    expect(updates.at(-1)).toEqual(["SER-1", "SER-2"]);
    expect(
      serialCountDifference(makeRow({ actual_serials: ["SER-1", "SER-X"] })),
    ).toEqual({
      missing: ["SER-2"],
      found: ["SER-X"],
    });
    wrapper.unmount();
  });

  it("scans a serial to add it and keeps untouched rows uncounted", async () => {
    const call = vi.fn(async () => ({
      serial: "SER-X",
      matches: [{ item_code: "SERIAL-ITEM" }],
    }));
    const { wrapper, updates } = mountChecklist(makeRow(), call);
    await wrapper.get("input").setValue("SER-X");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(call).toHaveBeenCalledWith("catalog.scan_code", { value: "SER-X" });
    expect(call).toHaveBeenNthCalledWith(2, "counts.validate_count_serial", {
      item_code: "SERIAL-ITEM",
      warehouse: "ROOM-A",
      serial: "SER-X",
    });
    expect(updates[0]).toEqual(["SER-X"]);
    expect(makeRow().actual_serials).toBeNull();
    wrapper.unmount();
  });

  it("counts serial set changes even when quantities match", () => {
    const row = makeRow({
      actual_serials: ["SER-1", "SER-X"],
      actual_qty: 2,
      review_state: "Reviewed",
    });
    expect(countSummary([row]).changed).toBe(1);
    expect(countIssues([row], [{ name: "Nos", whole: true }])).toEqual([]);
  });

  it("groups present, unconfirmed and missing serials and pages long lists", async () => {
    const serials = Array.from(
      { length: 100 },
      (_, index) => `SER-${index + 1}`,
    );
    const row = makeRow({
      baseline_qty: serials.length,
      baseline_serials: serials,
      actual_qty: 1,
      actual_serials: [serials[0]!],
      review_state: "Reviewed",
    });
    const { wrapper } = mountChecklist(row);
    expect(wrapper.text()).toContain("在位");
    expect(wrapper.text()).toContain("缺少");
    expect(wrapper.findAll(".serial-count-chip")).toHaveLength(8);
    await wrapper.get(".serial-count-more").trigger("click");
    expect(wrapper.findAll(".serial-count-chip")).toHaveLength(100);
    wrapper.unmount();

    const untouched = mountChecklist(makeRow());
    expect(untouched.wrapper.text()).toContain("未确认");
    expect(untouched.wrapper.findAll(".serial-count-chip")).toHaveLength(2);
    untouched.wrapper.unmount();
  });

  it("shows saved book, actual, missing and found serials in read-only details", () => {
    const wrapper = mount(NativeCountAllocations, {
      props: {
        row: {
          stock_uom: "Nos",
          recorded_count_serial_allocations: [
            {
              baseline_serials: ["SER-1", "SER-2"],
              actual_serials: ["SER-1", "SER-X"],
              missing_serials: ["SER-2"],
              found_serials: ["SER-X"],
            },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain("账面：SER-1、SER-2");
    expect(wrapper.text()).toContain("实点：SER-1、SER-X");
    expect(wrapper.text()).toContain("缺少：SER-2");
    expect(wrapper.text()).toContain("多出：SER-X");
    wrapper.unmount();
  });
});
