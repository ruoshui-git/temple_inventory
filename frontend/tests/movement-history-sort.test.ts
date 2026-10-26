// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { MovementHistoryRow } from "../src/lib/reportContract";
import MovementHistoryTable from "../src/components/ui/MovementHistoryTable.vue";
import { useMovementHistory } from "../src/features/movements/useMovementHistory";
import { newReportQuery } from "../src/lib/reportContract";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

describe("movement history server sorting", () => {
  it("sends canonical sort intent before paging the complete history", async () => {
    const reference = createReferenceData();
    reference.user = "sort-user";
    const historyRow: MovementHistoryRow = {
      id: "SE-1",
      doctype: "Stock Entry",
      document: "SE-1",
      item_code: "ITEM-1",
      item_name: "测试物品",
      date_time: "2026-10-20 10:00:00",
      kind: "Receive",
      source_warehouse: "",
      destination_warehouse: "WH-1",
      stock_uom: "Nos",
      docstatus: 1,
      quantity: 1,
      available_effect: 1,
      loan_balance_effect: 0,
      borrower: "",
    };
    const call = vi.fn(
      async (_method: string, _args: Record<string, unknown>) => ({
        rows: [historyRow],
        matched_count: 0,
        next_start: null,
      }),
    );
    const services = { call, report: vi.fn(), upload: vi.fn() };
    const Consumer = defineComponent({
      setup() {
        const query = computed(() => newReportQuery("movements"));
        const history = useMovementHistory(query, {
          itemCode: () => "ITEM-1",
        });
        return () =>
          h(MovementHistoryTable, {
            rows: history.result.rows,
            total: history.result.total,
            initialized: history.result.initialized,
            sortBy: history.sortBy.value,
            sortDirection: history.sortDirection.value,
            onSort: history.setSort,
          });
      },
    });
    const Host = defineComponent({
      setup() {
        provideInventoryServices(services, reference);
        return () => h(Consumer);
      },
    });
    const wrapper = mount(Host);
    await flushPromises();
    const firstQuery = call.mock.calls[0]?.[1].query as Record<string, unknown>;
    expect(firstQuery).toMatchObject({
      dataset: "movements",
      view: "lines",
      sortBy: "date",
      sort: "desc",
    });
    await wrapper.get("button.data-table-sort").trigger("click");
    await nextTick();
    await flushPromises();
    const nextQuery = call.mock.calls.at(-1)?.[1].query as Record<
      string,
      unknown
    >;
    expect(nextQuery).toMatchObject({ sortBy: "document", sort: "asc" });
    expect(nextQuery.groupBy).toEqual([]);
    wrapper.unmount();
  });
});
