import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import MovementHistoryTable from "../src/components/ui/MovementHistoryTable.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { defineComponent, h } from "vue";

const row = {
  id: "Stock Entry:SE-1",
  doctype: "Stock Entry" as const,
  document: "SE-1",
  item_code: "A",
  item_name: "物品甲",
  date_time: "2026-10-19 09:00:00",
  kind: "Receive",
  source_warehouse: "",
  destination_warehouse: "ROOM",
  stock_uom: "Nos",
  docstatus: 1,
  quantity: 5,
  available_effect: 5,
  loan_balance_effect: 0,
  borrower: "",
};
describe("typed movement history table", () => {
  it("renders expanded phone history as stacked records with sort, count and load-more", async () => {
    const longRow = { ...row, document: "SE-2026-00001124" };
    const reference = createReferenceData();
    Object.assign(reference, {
      user: "test",
      warehouses: [
        {
          name: "ROOM",
          label: "A02",
          local_label: "演示室甲",
          short_label: "A02",
          full_label: "演示室甲",
          path: "T2 / A02",
          search_text: "T2 A02 演示室甲",
          kind: "room",
          owner: "",
          direct: false,
          storable: true,
          missing_direct: false,
          parent: "T2",
          is_group: false,
          disabled: false,
          version: "",
          protected: false,
          can_edit: false,
          lft: 1,
          rgt: 2,
        },
      ],
    });
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [longRow],
            total: 3,
            next: 1,
            initialized: true,
            sortBy: "date",
            sortDirection: "desc",
          });
      },
    });
    const wrapper = mount(Host);
    expect(wrapper.get(".movement-history-mobile").text()).toContain(
      "1 / 3 条记录",
    );
    expect(wrapper.get(".history-mobile-row").text()).toContain("入库");
    expect(wrapper.get(".history-mobile-row").text()).toContain("…00001124");
    expect(wrapper.get(".history-mobile-row").text()).toContain("10-19 09:00");
    expect(wrapper.get(".history-mobile-row").text()).toContain("A02");
    const mobileRecord = wrapper.get(".history-mobile-row");
    const referenceChip = mobileRecord.get(".record-ref-chip");
    expect(referenceChip.text()).toContain("…00001124");
    expect(referenceChip.attributes("aria-label")).toContain(
      "SE-2026-00001124",
    );
    expect(referenceChip.find(".browse-badge").exists()).toBe(false);
    expect(mobileRecord.get(".history-mobile-status").text()).toContain(
      "已提交",
    );
    await wrapper.get(".history-mobile-sort").trigger("click");
    await wrapper
      .get(".movement-history-mobile button.ui-button")
      .trigger("click");
    const table = wrapper.findComponent(MovementHistoryTable);
    expect(table.emitted("sort")).toEqual([["date"]]);
    expect(table.emitted("loadMore")).toHaveLength(1);
  });

  it("uses fixed columns, status, accessible effect text, and native document action", async () => {
    const reference = createReferenceData();
    Object.assign(reference, {
      user: "test",
      warehouses: [
        {
          name: "ROOM",
          label: "A02",
          local_label: "演示室甲",
          short_label: "A02",
          full_label: "演示室甲",
          path: "T2 / A02",
          search_text: "T2 A02 演示室甲",
          kind: "room",
          owner: "",
          direct: false,
          storable: true,
          missing_direct: false,
          parent: "T2",
          is_group: false,
          disabled: false,
          version: "",
          protected: false,
          can_edit: false,
          lft: 1,
          rgt: 2,
        },
      ],
    });
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, { rows: [row], total: 1, initialized: true });
      },
    });
    const wrapper = mount(Host);
    expect(wrapper.text()).toContain("记录");
    expect(wrapper.text()).toContain("已提交");
    expect(wrapper.get("tbody tr").attributes("aria-label")).toContain(
      "增加可用库存",
    );
    expect(
      wrapper
        .findAll("th")
        .map((cell) => cell.text())
        .join(" "),
    ).toContain("数量");
    expect(
      wrapper
        .findAll("th")
        .map((cell) => cell.text())
        .join(" "),
    ).toContain("库存单位");
    expect(
      wrapper.findAll("tbody td span").some((cell) => cell.text() === "5"),
    ).toBe(true);
    expect(
      wrapper.findAll("tbody td").some((cell) => cell.text() === "Nos"),
    ).toBe(true);
    expect(wrapper.findAll("th").some((cell) => cell.text() === "操作")).toBe(
      false,
    );
    expect(wrapper.get("tbody tr td").classes()).not.toContain(
      "history-record",
    );
    expect(wrapper.get("tbody tr td .history-record").exists()).toBe(true);
  });

  it("routes original loans to loan detail and emits actual item selections", async () => {
    const reference = createReferenceData();
    reference.user = "test";
    const loan = {
      ...row,
      kind: "Loan",
      borrowed: 5,
      outstanding: 3,
    };
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [loan],
            total: 1,
            initialized: true,
            mode: "loan-allocation",
            includeItem: true,
          });
      },
    });
    const wrapper = mount(Host),
      table = wrapper.findComponent(MovementHistoryTable);
    await wrapper
      .get("tbody .history-record .record-ref-chip")
      .trigger("click");
    await wrapper.findAll("tbody td button")[1]?.trigger("click");
    expect(table.emitted("openLoan")).toEqual([["SE-1"]]);
    expect(table.emitted("openItem")).toEqual([["A"]]);
  });

  it("keeps physical quantities unsigned for Issue while showing the decrease", () => {
    const reference = createReferenceData();
    reference.user = "test";
    const issue = { ...row, kind: "Issue", quantity: 5, available_effect: -5 };
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [issue],
            total: 1,
            initialized: true,
          });
      },
    });
    const wrapper = mount(Host);
    const cells = wrapper.findAll("tbody td:not(.data-table-settings-cell)");
    expect(cells.at(-2)?.find("span").text()).toBe("5");
    expect(cells.at(-1)?.text()).toBe("Nos");
    expect(cells.at(-1)?.text()).not.toContain("+5");
    expect(cells.at(-2)?.find("span").classes()).toContain(
      "history-effect-quantity-down",
    );
    expect(wrapper.get("tbody tr").classes()).toContain("history-effect-down");
  });

  it("signs loan balances without applying physical stock tint", () => {
    const reference = createReferenceData();
    reference.user = "test";
    const loan = {
      ...row,
      kind: "Loan",
      quantity: 5,
      loan_balance_effect: 5,
      available_effect: 0,
    };
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [loan],
            total: 1,
            initialized: true,
            mode: "loan-balance",
          });
      },
    });
    const wrapper = mount(Host);
    expect(wrapper.text()).toContain("+5");
    expect(wrapper.get("tbody tr").classes()).not.toContain(
      "history-effect-up",
    );
    expect(wrapper.findAll("th").some((cell) => cell.text() === "操作")).toBe(
      false,
    );
  });

  it("shows a local load-more indicator without treating refresh as load-more", () => {
    const reference = createReferenceData();
    reference.user = "test";
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [row],
            total: 2,
            next: 1,
            loading: true,
            initialized: true,
            stale: false,
          });
      },
    });
    const wrapper = mount(Host);
    expect(wrapper.text()).toContain("正在加载更多结果…");

    wrapper.unmount();

    const RefreshHost = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [row],
            total: 2,
            next: 1,
            loading: true,
            initialized: true,
            stale: true,
          });
      },
    });
    const refreshing = mount(RefreshHost);
    expect(refreshing.text()).toContain("加载更多 · 1 / 2");
  });

  it("applies physical stock effects to handling rows while keeping their quantities unsigned", () => {
    const reference = createReferenceData();
    reference.user = "test";
    const handling = {
      ...row,
      kind: "Return",
      quantity: 3,
      available_effect: 3,
    };
    const Host = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(MovementHistoryTable, {
            rows: [handling],
            total: 1,
            initialized: true,
            mode: "handling",
          });
      },
    });
    const wrapper = mount(Host);
    const quantityCell = wrapper
      .findAll("tbody td:not(.data-table-settings-cell)")
      .at(-2)!;
    expect(quantityCell.find("span").text()).toBe("3");
    expect(quantityCell.text()).not.toContain("+3");
    expect(quantityCell.classes()).toContain("history-effect-quantity-up");
    expect(wrapper.get("tbody tr").attributes("aria-label")).toContain(
      "增加可用库存",
    );
  });
});
