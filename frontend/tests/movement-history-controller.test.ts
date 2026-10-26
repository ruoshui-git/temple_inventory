// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive, computed } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import { useMovementHistory } from "../src/features/movements/useMovementHistory";

const page = (
  rows: any[],
  matched_count = rows.length,
  next_start: number | null = null,
) => ({
  rows,
  matched_count,
  next_start,
});
const row = {
  id: "SE-1",
  doctype: "Stock Entry",
  document: "SE-1",
  item_code: "A",
  item_name: "甲",
  date_time: "2026-10-19 09:00:00",
  kind: "Receive",
  source_warehouse: "",
  destination_warehouse: "W",
  stock_uom: "Nos",
  docstatus: 1,
  quantity: 2,
  available_effect: 2,
  loan_balance_effect: 0,
  borrower: "",
};

function host(call: ReturnType<typeof vi.fn>) {
  const reference = createReferenceData();
  reference.user = "one";
  const scope = reactive({ location: "W" });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() } as never,
          reference,
        );
        return () => h(Child, { reference, scope });
      },
    }),
  );
  return { wrapper, vm: wrapper.findComponent(Child).vm, reference, scope };
}

const Child = defineComponent({
  props: ["reference", "scope"],
  setup(props) {
    const query = computed(() => ({
      ...newReportQuery("movements"),
      scope: {
        ...newReportQuery("movements").scope,
        warehouses: [(props.scope as { location: string }).location],
      },
    }));
    const history = useMovementHistory(query);
    return { history };
  },
  render: () => h("div"),
});

describe("movement history controller", () => {
  it("retries a failed next page at the same offset", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page([row], 2, 1))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        page([{ ...row, id: "SE-2", document: "SE-2" }], 2, null),
      );
    const wrapper = host(call);
    await flushPromises();
    await wrapper.vm.history.loadMore();
    await flushPromises();
    expect(wrapper.vm.history.result.rows).toHaveLength(1);
    await wrapper.vm.history.retry();
    await flushPromises();
    expect(
      call.mock.calls.map(([endpoint, args]) => [endpoint, args.start]),
    ).toEqual([
      ["browse.movement_history", 0],
      ["browse.movement_history", 1],
      ["browse.movement_history", 1],
    ]);
    expect(wrapper.vm.history.result.rows).toHaveLength(2);
  });

  it("clears stale rows and ignores an old response after scope or account changes", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveAccount!: (value: unknown) => void;
    const call = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(page([{ ...row, document: "SE-2", id: "SE-2" }]))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAccount = resolve;
          }),
      );
    const wrapper = host(call);
    wrapper.vm.scope.location = "W2";
    await flushPromises();
    resolveFirst(page([row]));
    await flushPromises();
    expect(
      wrapper.vm.history.result.rows.map((entry: any) => entry.document),
    ).toEqual(["SE-2"]);
    wrapper.vm.reference.user = "two";
    await flushPromises();
    expect(wrapper.vm.history.result.rows).toEqual([]);
    resolveAccount(page([{ ...row, document: "SE-3", id: "SE-3" }]));
  });

  it("clears prior rows when permission or document availability changes", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page([row]))
      .mockRejectedValueOnce({ kind: "PermissionError" });
    const wrapper = host(call);
    await flushPromises();
    wrapper.vm.scope.location = "W2";
    await flushPromises();
    expect(wrapper.vm.history.result.rows).toEqual([]);
    expect(wrapper.vm.history.result.initialized).toBe(false);
  });
});
