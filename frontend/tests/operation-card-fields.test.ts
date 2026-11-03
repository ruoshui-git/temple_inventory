// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import OperationBrowsePage from "../src/features/movements/OperationBrowsePage.vue";
import { newReportQuery } from "../src/lib/reportContract";
import { browseLayoutStorageKey } from "../src/composables/useBrowseViewMode";

const wrappers: VueWrapper[] = [];

beforeEach(() => localStorage.clear());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.clear();
});

function viewport(desktop: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches: desktop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function record() {
  return {
    id: "REC-1",
    row_grain: "record",
    doctype: "Stock Entry",
    document: "STE-RECORD-1",
    kind: "Issue",
    date: "2026-10-20",
    docstatus: 1,
    item_count: 1,
    activity_title: "ACT-9",
    whole: {
      quantities: [{ uom: "Nos", qty: 3 }],
      available_effects: [{ uom: "Nos", qty: -3 }],
      branches: [{ source: "仓库甲", destination: "" }],
      outstanding: [],
      original_loans: [],
    },
  };
}

function service() {
  return vi.fn(async (endpoint: string) => {
    if (endpoint === "browse.operation_page") {
      return {
        rows: [record()],
        query: newReportQuery("movements"),
        matched_count: 1,
        next_start: null,
        snapshot: "2026-10-16 10:00:00",
        summary: {
          item_count: 1,
          document_count: 1,
          category_count: 1,
          allocation_count: 1,
        },
        totals: [],
        analysis: {},
      };
    }
    if (endpoint === "browse.movement_history")
      return {
        rows: [
          {
            id: "movement-history-row",
            document: "STE-MOVE-1",
            doctype: "Stock Entry",
            kind: "Receive",
            date_time: "2026-10-20 09:00:00",
            stock_qty: 7,
            available_effect: 7,
            stock_uom: "Nos",
            item_code: "ITEM-A",
            item_name: "物品甲",
            docstatus: 1,
          },
        ],
        matched_count: 1,
        next_start: null,
        history_complete: true,
      };
    throw new Error(`Unexpected ${endpoint}`);
  });
}

/** Zero matches for every read, so each layout shows its empty state. */
function emptyService() {
  return vi.fn(async (endpoint: string) => {
    if (endpoint === "browse.operation_page")
      return {
        rows: [],
        query: newReportQuery("movements"),
        matched_count: 0,
        next_start: null,
        snapshot: "2026-10-16 10:00:00",
        summary: {
          item_count: 0,
          document_count: 0,
          category_count: 0,
          allocation_count: 0,
        },
        totals: [],
        analysis: {},
      };
    if (
      endpoint === "browse.movement_history" ||
      endpoint === "browse.operation_contributions"
    )
      return {
        rows: [],
        columns: [],
        matched_count: 0,
        next_start: null,
        history_complete: true,
      };
    return service()(endpoint);
  });
}

/** Makes every [data-clamp] value report cut-off text, as a narrow phone does for long names. */
function clampedText() {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-clamp") ? 40 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 20,
  });
  return () => {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  };
}

function countText(wrapper: VueWrapper, text: string) {
  return wrapper.text().split(text).length - 1;
}

function mountPage(
  records: boolean,
  call: ReturnType<typeof vi.fn> = service(),
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "unit-site",
    user: "volunteer",
    operations: { Return: true },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () =>
        h(OperationBrowsePage, { family: "movements" as const, records });
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/items/:code",
        name: "item-detail",
        component: defineComponent(() => () => h("div")),
      },
      {
        path: "/drafts",
        name: "drafts",
        component: defineComponent(() => () => h("div")),
      },
    ],
  });
  const wrapper = mount(root, {
    attachTo: document.body,
    global: { plugins: [router] },
  });
  wrappers.push(wrapper);
  return wrapper;
}

async function settle(wrapper: VueWrapper) {
  await flushPromises();
  await flushPromises();
  return wrapper;
}

function toggleLabels(wrapper: VueWrapper, label: string) {
  return wrapper
    .findAll(`[aria-label="${label}"] button`)
    .map((button) => button.text().trim());
}

function hasToggle(wrapper: VueWrapper, label: string) {
  return wrapper.find(`[aria-label="${label}"]`).exists();
}

/** Hide one column through the 显示字段 panel that the current layout renders. */
async function hideColumn(wrapper: VueWrapper, label: string) {
  await wrapper.get(".data-table-column-trigger").trigger("click");
  await flushPromises();
  const panel = document.body.querySelector(".data-table-column-panel");
  const input = [...(panel?.querySelectorAll("label") || [])]
    .find((item) => item.textContent?.trim() === label)
    ?.querySelector("input");
  expect(input, `显示字段 has ${label}`).toBeTruthy();
  input!.click();
  await flushPromises();
  // Close the panel so the next layout's trigger is the only one the test reaches.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await flushPromises();
}

describe("operation browse layouts", () => {
  it("keeps phone record 列表/表格 and 显示字段 in the summary row, not the 更多操作 menu", async () => {
    viewport(false);
    const phone = await settle(mountPage(true));
    expect(toggleLabels(phone, "货物流动记录视图")).toEqual(["列表", "表格"]);
    expect(
      phone
        .find('.browse-summary-controls button[aria-label="表格视图"]')
        .exists(),
    ).toBe(true);
    expect(
      phone
        .find(".browse-summary-controls .data-table-column-trigger")
        .exists(),
    ).toBe(true);
    await phone.get('[aria-label="更多操作"]').trigger("click");
    await flushPromises();
    const menuItems = [...document.body.querySelectorAll("button")].map(
      (button) => button.textContent?.trim(),
    );
    expect(menuItems).not.toContain("以表格显示");
    expect(menuItems).not.toContain("显示字段");
    await phone.get('[aria-label="更多操作"]').trigger("click");
    await flushPromises();
    expect(phone.find(".operation-record-list").exists()).toBe(true);
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    viewport(true);
    const desktop = await settle(mountPage(true));
    expect(hasToggle(desktop, "货物流动记录视图")).toBe(false);
    expect(desktop.find(".operation-record-list").exists()).toBe(false);
    expect(desktop.find("table").exists()).toBe(true);
  });

  it("offers 列表/卡片 for phone items and 表格/卡片 on desktop", async () => {
    viewport(false);
    const phone = await settle(mountPage(false));
    expect(toggleLabels(phone, "物品汇总视图")).toEqual([
      "列表",
      "卡片",
      "表格",
    ]);
    expect(
      phone.get('[aria-label="列表视图"]').attributes("aria-pressed"),
    ).toBe("true");
    // Phone item rows are 库存 rows: thumbnail, name, then the quantity change.
    const row = phone.get(".operation-item-list .stock-list-row");
    expect(row.find(".stock-list-image").exists()).toBe(true);
    expect(row.get(".stock-list-name").text()).toBe("物品甲");
    expect(row.find(".stock-list-quantity").exists()).toBe(true);
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    viewport(true);
    const desktop = await settle(mountPage(false));
    expect(toggleLabels(desktop, "物品汇总视图")).toEqual(["表格", "卡片"]);
    expect(
      desktop.get('[aria-label="表格视图"]').attributes("aria-pressed"),
    ).toBe("true");
  });

  it("shows the phone item table in place of the 列表 rows", async () => {
    viewport(false);
    const phone = await settle(mountPage(false));
    await phone
      .get('.browse-summary-controls button[aria-label="表格视图"]')
      .trigger("click");
    await flushPromises();
    expect(phone.find("table").exists()).toBe(true);
    expect(phone.find(".operation-item-list").exists()).toBe(false);
    expect(phone.find(".stock-list-row").exists()).toBe(false);
    expect(phone.find(".browse-load-more").exists()).toBe(false);
  });

  it("shows the item empty message once in every item layout", async () => {
    const cases = [
      { desktop: false, layout: "列表视图" },
      { desktop: false, layout: "卡片视图" },
      { desktop: true, layout: "卡片视图" },
      { desktop: true, layout: "表格视图" },
    ];
    for (const { desktop, layout } of cases) {
      viewport(desktop);
      const wrapper = await settle(mountPage(false, emptyService()));
      await wrapper
        .get(`.browse-summary-controls button[aria-label="${layout}"]`)
        .trigger("click");
      await flushPromises();
      expect(countText(wrapper, "没有匹配的物品"), layout).toBe(1);
      // The table keeps its own empty row; the other layouts use BrowseEmpty.
      expect(wrapper.findAll(".browse-empty"), layout).toHaveLength(
        layout === "表格视图" ? 0 : 1,
      );
      wrapper.unmount();
      wrappers.splice(wrappers.indexOf(wrapper), 1);
    }
  });

  it("shows the record empty message once in 列表 and in the table", async () => {
    viewport(false);
    const phone = await settle(mountPage(true, emptyService()));
    expect(countText(phone, "没有匹配的记录")).toBe(1);
    expect(phone.findAll(".browse-empty")).toHaveLength(1);
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    viewport(true);
    const desktop = await settle(mountPage(true, emptyService()));
    expect(countText(desktop, "没有匹配的记录")).toBe(1);
    expect(desktop.findAll(".browse-empty")).toHaveLength(0);
  });

  it("opens every field from 更多 and 打开 runs the row's own open", async () => {
    const restore = clampedText();
    try {
      viewport(false);
      const items = await settle(mountPage(false));
      await items.get(".stock-list-row .card-fields-more").trigger("click");
      await flushPromises();
      const sheet = document.body.querySelector(".row-fields-sheet");
      expect(sheet?.textContent).toContain("ITEM-A");
      const open = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "打开",
      );
      open!.click();
      await flushPromises();
      expect(
        items.findComponent(OperationBrowsePage).emitted("openItem"),
      ).toEqual([["ITEM-A"]]);
      expect(document.body.querySelector(".row-fields-sheet")).toBeNull();
      items.unmount();
      wrappers.splice(wrappers.indexOf(items), 1);

      const records = await settle(mountPage(true));
      await records
        .get(".operation-record-list .card-fields-more")
        .trigger("click");
      await flushPromises();
      const recordOpen = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "打开",
      );
      recordOpen!.click();
      await flushPromises();
      expect(
        records.findComponent(OperationBrowsePage).emitted("openDocument"),
      ).toEqual([["Stock Entry", "STE-RECORD-1"]]);
    } finally {
      restore();
    }
  });

  it("keeps the chosen layout for each page across remounts", async () => {
    viewport(true);
    const first = await settle(mountPage(false));
    await first.get('[aria-label="卡片视图"]').trigger("click");
    await flushPromises();
    expect(first.find(".operation-item-card-grid").exists()).toBe(true);
    expect(
      localStorage.getItem(
        browseLayoutStorageKey(
          "unit-site",
          "volunteer",
          "operations.movements.items",
        ),
      ),
    ).toContain('"desktop":"card"');
    first.unmount();
    wrappers.splice(wrappers.indexOf(first), 1);

    const second = await settle(mountPage(false));
    expect(
      second.get('[aria-label="卡片视图"]').attributes("aria-pressed"),
    ).toBe("true");
    expect(second.find(".operation-item-card-grid").exists()).toBe(true);
  });

  it("removes a hidden column from the table, item cards and record rows alike", async () => {
    viewport(true);
    const items = await settle(mountPage(false));
    await hideColumn(items, "日期");
    expect(items.findAll("thead th").map((th) => th.text())).not.toContain(
      "日期",
    );

    await items.get('[aria-label="卡片视图"]').trigger("click");
    await flushPromises();
    expect(
      items.findAll(".card-field dt").map((dt) => dt.text()),
    ).not.toContain("日期");
    expect(items.text()).not.toContain("2026-10-20");
    items.unmount();
    wrappers.splice(wrappers.indexOf(items), 1);

    viewport(false);
    const phoneItems = await settle(mountPage(false));
    expect(phoneItems.text()).not.toContain("2026-10-20");
    expect(phoneItems.text()).toContain("ITEM-A");
    phoneItems.unmount();
    wrappers.splice(wrappers.indexOf(phoneItems), 1);

    viewport(true);
    const records = await settle(mountPage(true));
    expect(records.text()).toContain("2026-10-20");
    await hideColumn(records, "日期");
    expect(records.findAll("thead th").map((th) => th.text())).not.toContain(
      "日期",
    );
    records.unmount();
    wrappers.splice(wrappers.indexOf(records), 1);

    viewport(false);
    const phoneRecords = await settle(mountPage(true));
    expect(
      phoneRecords
        .findAll(".operation-record-row-content")
        .map((row) => row.text())
        .join(" "),
    ).not.toContain("2026-10-20");
    expect(phoneRecords.text()).toContain("STE-RECORD-1");
  });
});
