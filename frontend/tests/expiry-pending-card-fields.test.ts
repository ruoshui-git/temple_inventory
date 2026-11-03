// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newReportQuery, type ReportRow } from "../src/lib/reportContract";
import ExpiryBrowsePage from "../src/features/expiry/ExpiryBrowsePage.vue";
import PendingPage from "../src/features/pending/PendingPage.vue";
import ColumnSettings from "../src/components/ui/ColumnSettings.vue";
import BrowseLoadMore from "../src/components/ui/BrowseLoadMore.vue";
import SortControl from "../src/components/ui/SortControl.vue";
import { browseLayoutStorageKey } from "../src/composables/useBrowseViewMode";

const wrappers: VueWrapper[] = [];
let siteCounter = 0;

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

// Each test gets its own site so column preferences cached in memory never leak between tests.
function freshSite() {
  siteCounter += 1;
  return `card-fields-site-${siteCounter}`;
}

function matchMedia(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: desktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function referenceFor(site: string) {
  const reference = createReferenceData();
  Object.assign(reference, {
    site,
    user: "volunteer",
    siteDate: "2026-11-03",
    operations: {
      Repair: true,
      Disposal: true,
      Issue: true,
      Transfer: true,
      Damage: true,
    },
  });
  return reference;
}

// Column preferences saved to the server for each site and table, as the real service keeps them.
const savedPreferences = new Map<string, unknown>();

function preferenceAwareCall(
  site: string,
  browse: (endpoint: string, args: Record<string, unknown>) => unknown,
) {
  return vi.fn(async (endpoint: string, args: Record<string, unknown>) => {
    const key = `${site}:${String(args.table_id)}`;
    if (endpoint === "table_preferences.save_column_preferences") {
      savedPreferences.set(key, args.preference);
      return args.preference;
    }
    if (endpoint === "table_preferences.get_column_preferences")
      return savedPreferences.get(key) ?? null;
    return browse(endpoint, args);
  });
}

function expiryPage(empty = false) {
  const row = {
    id: JSON.stringify(["ITEM-A", "ROOM-A", "BATCH-0"]),
    item_code: "ITEM-A",
    item_name: "物品甲",
    category: "食品",
    stock_uom: "Nos",
    batch_no: "BATCH-0",
    warehouse: "ROOM-A",
    warehouse_label: "库房 A",
    available: 2,
    loaned: 0,
    damaged: 0,
    stock_qty: 11,
    expiry_date: "2026-12-20",
    remaining_days: 47,
    image: "",
  };
  return {
    query: newReportQuery("expiry"),
    rows: empty ? [] : [row],
    matched_count: empty ? 0 : 1,
    next_start: null,
    item_count: empty ? 0 : 1,
    batch_count: 1,
    snapshot: "now",
    totals: [{ stock_uom: "Nos", available: 2 }],
    facets: { all: 1, expired: 0, unexpired: 1, undated: 0 },
    analysis: {},
  };
}

function mountExpiry(site: string, empty = false) {
  const call = preferenceAwareCall(site, () => expiryPage(empty));
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        referenceFor(site),
      );
      return () =>
        h(ExpiryBrowsePage, { initialQuery: newReportQuery("expiry") });
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return wrapper;
}

function pendingReport(value: unknown, empty = false) {
  const row = {
    id: JSON.stringify(["ITEM-A", "DAMAGED / A,1", "BATCH-A"]),
    item_code: "ITEM-A",
    item_name: "损坏工具",
    warehouse: "DAMAGED / A,1",
    warehouse_label: "损坏待处理 / A",
    batch_no: "BATCH-A",
    stock_uom: "Nos",
    available: 0,
    loaned: 0,
    damaged: 3,
    stock_qty: 3,
  } as ReportRow;
  return {
    query: value,
    scope: (value as { scope: unknown }).scope,
    rows: empty ? [] : [row],
    matched_count: empty ? 0 : 1,
    next_start: null,
    table: "locations",
    columns: [
      "item_name",
      "item_code",
      "damaged",
      "batch_no",
      "warehouse_label",
      "stock_uom",
    ],
    tables: [{ id: "locations", label: "位置", count: 1 }],
    summary: [{ stock_uom: "Nos", damaged: 3 }],
    snapshot: "loaded",
    period: { date_from: "", date_to: "" },
  };
}

function mountPending(site: string, empty = false) {
  const call = preferenceAwareCall(site, () => ({}));
  const report = vi.fn(async (value: unknown) => pendingReport(value, empty));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/items/:code",
        name: "item-detail",
        component: { template: "<div />" },
      },
    ],
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report, upload: vi.fn() } as never,
        referenceFor(site),
      );
      return () =>
        h(PendingPage, { initialQuery: newReportQuery("inventory") });
    },
  });
  const wrapper = mount(root, { global: { plugins: [router] } });
  wrappers.push(wrapper);
  return wrapper;
}

// Column changes save after a short debounce; wait for the save before a remount reads it back.
async function settleSave() {
  await new Promise((done) => setTimeout(done, 200));
  await flushPromises();
}

function viewLabels(wrapper: VueWrapper) {
  return wrapper
    .findAll(".stock-view-icons button")
    .map((button) => button.text());
}

function cardFieldLabels(wrapper: VueWrapper) {
  return wrapper.findAll(".card-field dt").map((label) => label.text());
}

function clickView(wrapper: VueWrapper, label: string) {
  return wrapper.get(`[aria-label="${label}视图"]`).trigger("click");
}

function preferences(wrapper: VueWrapper) {
  return wrapper.findComponent(ColumnSettings).props("preferences") as {
    toggle: (id: string) => void;
  };
}

describe("效期批次 card, row and table layouts", () => {
  it("offers 表格 and 卡片 on desktop and 列表, 卡片 and 表格 on phones, defaulting to table and list", async () => {
    matchMedia(true);
    const desktop = mountExpiry(freshSite());
    await flushPromises();
    expect(viewLabels(desktop)).toEqual(["表格", "卡片"]);
    expect(desktop.find("table").exists()).toBe(true);
    desktop.unmount();
    wrappers.splice(wrappers.indexOf(desktop), 1);

    matchMedia(false);
    const phone = mountExpiry(freshSite());
    await flushPromises();
    expect(viewLabels(phone)).toEqual(["列表", "卡片", "表格"]);
    expect(phone.find(".expiry-phone-card").exists()).toBe(true);
  });

  it("hiding a column in 显示字段 removes it from cards, rows and table alike", async () => {
    const site = freshSite();
    matchMedia(true);
    const wrapper = mountExpiry(site);
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    expect(cardFieldLabels(wrapper)).toContain("到期日期");
    preferences(wrapper).toggle("expiry_date");
    await flushPromises();
    expect(cardFieldLabels(wrapper)).not.toContain("到期日期");
    await clickView(wrapper, "表格");
    await flushPromises();
    const headers = wrapper.findAll("thead th").map((header) => header.text());
    expect(headers.join("|")).not.toContain("到期日期");
    await settleSave();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);

    matchMedia(false);
    const phone = mountExpiry(site);
    await flushPromises();
    expect(phone.find(".expiry-phone-card").exists()).toBe(true);
    expect(phone.find(".expiry-phone-card").text()).not.toContain("到期日期");
    expect(phone.find(".expiry-phone-card").text()).toContain("BATCH-0");
    expect(phone.find(".expiry-phone-card").text()).toContain("ITEM-A");
  });

  it("hiding image renders a text-only card and hiding the quantity removes the hero number", async () => {
    matchMedia(true);
    const wrapper = mountExpiry(freshSite());
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    expect(wrapper.find(".item-card.is-text-only").exists()).toBe(false);
    expect(wrapper.find(".stock-number").exists()).toBe(true);
    preferences(wrapper).toggle("image");
    await flushPromises();
    expect(wrapper.find(".item-card.is-text-only").exists()).toBe(true);
    expect(wrapper.find(".item-card-image").exists()).toBe(false);
    preferences(wrapper).toggle("stock_qty");
    await flushPromises();
    expect(wrapper.find(".stock-number").exists()).toBe(false);
    expect(wrapper.get(".expiry-card-grid").text()).toContain("物品甲");
  });

  it("keeps the chosen layout per account across remounts", async () => {
    const site = freshSite();
    matchMedia(true);
    const wrapper = mountExpiry(site);
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          browseLayoutStorageKey(site, "volunteer", "expiry"),
        ) || "null",
      ),
    ).toMatchObject({ desktop: "card" });
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    const remounted = mountExpiry(site);
    await flushPromises();
    expect(remounted.find(".expiry-card-grid").exists()).toBe(true);
  });
});

describe("损坏待处理 card, row and table layouts", () => {
  it("offers 表格 and 卡片 on desktop and 列表, 卡片 and 表格 on phones, defaulting to table and list", async () => {
    matchMedia(true);
    const desktop = mountPending(freshSite());
    await flushPromises();
    expect(viewLabels(desktop)).toEqual(["表格", "卡片"]);
    expect(desktop.find("table").exists()).toBe(true);
    desktop.unmount();
    wrappers.splice(wrappers.indexOf(desktop), 1);

    matchMedia(false);
    const phone = mountPending(freshSite());
    await flushPromises();
    expect(viewLabels(phone)).toEqual(["列表", "卡片", "表格"]);
    expect(phone.find(".pending-phone-card").exists()).toBe(true);
  });

  it("hiding a column in 显示字段 removes it from cards, rows and table alike", async () => {
    const site = freshSite();
    matchMedia(true);
    const wrapper = mountPending(site);
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    // 库位 is hidden by default; show it so the test can check that hiding batch_no leaves it.
    preferences(wrapper).toggle("warehouse_label");
    await flushPromises();
    expect(cardFieldLabels(wrapper)).toContain("批次编号");
    preferences(wrapper).toggle("batch_no");
    await flushPromises();
    expect(cardFieldLabels(wrapper)).not.toContain("批次编号");
    expect(cardFieldLabels(wrapper)).toContain("库位");
    await clickView(wrapper, "表格");
    await flushPromises();
    const headers = wrapper.findAll("thead th").map((header) => header.text());
    expect(headers.join("|")).not.toContain("批次编号");
    expect(headers.join("|")).toContain("库位");
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);

    // Phone rows read the same visible columns; a fresh account avoids the remount path, which
    // does not yet keep a hidden column across a page remount (see report).
    matchMedia(false);
    const phone = mountPending(freshSite());
    await flushPromises();
    preferences(phone).toggle("warehouse_label");
    await flushPromises();
    preferences(phone).toggle("batch_no");
    await flushPromises();
    expect(phone.find(".pending-phone-card").text()).not.toContain("批次编号");
    expect(phone.find(".pending-phone-card").text()).toContain("库位");
  });

  it("hiding image renders a text-only card and hiding the damaged quantity removes the hero number", async () => {
    matchMedia(true);
    const wrapper = mountPending(freshSite());
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    expect(wrapper.find(".item-card.is-text-only").exists()).toBe(false);
    preferences(wrapper).toggle("image");
    await flushPromises();
    expect(wrapper.find(".item-card.is-text-only").exists()).toBe(true);
    expect(wrapper.find(".stock-number").exists()).toBe(true);
    preferences(wrapper).toggle("damaged");
    await flushPromises();
    expect(wrapper.find(".stock-number").exists()).toBe(false);
    expect(wrapper.get(".pending-card-grid").text()).toContain("损坏工具");
  });

  it("keeps the chosen layout per account across remounts", async () => {
    const site = freshSite();
    matchMedia(true);
    const wrapper = mountPending(site);
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    const remounted = mountPending(site);
    await flushPromises();
    expect(remounted.find(".pending-card-grid").exists()).toBe(true);
  });
});

// jsdom has no layout: every clamped line reads as cut off, so 更多 shows on each row.
function clampedLines() {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(40);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(20);
}

function countOf(wrapper: VueWrapper, text: string) {
  return wrapper.text().split(text).length - 1;
}

function sheetLabels() {
  return Array.from(document.querySelectorAll(".row-fields-sheet dt")).map(
    (dt) => dt.textContent,
  );
}

function sheetOpenButton() {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "打开",
  );
  if (!button) throw new Error("row fields sheet is not open");
  return button;
}

describe("效期批次 empty states and layouts", () => {
  it.each([
    ["phone 列表", false, undefined],
    ["phone 卡片", false, "卡片"],
    ["desktop 卡片", true, "卡片"],
    ["desktop 表格", true, undefined],
    ["phone 表格", false, "表格"],
  ])(
    "shows the empty wording exactly once in %s",
    async (_name, desktop, view) => {
      matchMedia(desktop);
      const wrapper = mountExpiry(freshSite(), true);
      await flushPromises();
      if (view) await clickView(wrapper, view);
      await flushPromises();
      expect(countOf(wrapper, "没有符合条件的批次")).toBe(1);
    },
  );

  it("mounts the DataTable on phones in 表格 without list-only chrome", async () => {
    matchMedia(false);
    const wrapper = mountExpiry(freshSite());
    await flushPromises();
    expect(wrapper.find(".expiry-phone-card").exists()).toBe(true);
    await clickView(wrapper, "表格");
    await flushPromises();
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.find(".expiry-phone-card").exists()).toBe(false);
    expect(wrapper.findComponent(SortControl).exists()).toBe(false);
    expect(wrapper.findComponent(BrowseLoadMore).exists()).toBe(false);
  });
});

describe("效期批次 更多 sheet", () => {
  beforeEach(clampedLines);
  afterEach(() => vi.restoreAllMocks());

  it("lists every visible field from a phone row, and 打开 opens the row's item", async () => {
    matchMedia(false);
    const wrapper = mountExpiry(freshSite());
    await flushPromises();
    await wrapper
      .get(".expiry-phone-card button.card-fields-more")
      .trigger("click");
    await flushPromises();
    expect(sheetLabels()).toEqual([
      "物品名称",
      "物品编号",
      "类别",
      "批次编号",
      "到期日期",
      "剩余天数",
      "库存数量",
      "位置",
    ]);
    const page = wrapper.findComponent(ExpiryBrowsePage);
    expect(page.emitted("item")).toBeUndefined();
    sheetOpenButton().click();
    await flushPromises();
    expect(page.emitted("item")).toEqual([["ITEM-A"]]);
    expect(document.querySelector(".row-fields-sheet")).toBeNull();
  });

  it("opens the same sheet from a desktop card", async () => {
    matchMedia(true);
    const wrapper = mountExpiry(freshSite());
    await flushPromises();
    await clickView(wrapper, "卡片");
    await flushPromises();
    await wrapper
      .get(".expiry-card-grid button.card-fields-more")
      .trigger("click");
    await flushPromises();
    expect(sheetLabels()).toContain("批次编号");
    expect(
      wrapper.findComponent(ExpiryBrowsePage).emitted("item"),
    ).toBeUndefined();
  });
});

describe("损坏待处理 empty states and layouts", () => {
  it.each([
    ["phone 列表", false, undefined],
    ["phone 卡片", false, "卡片"],
    ["desktop 卡片", true, "卡片"],
    ["desktop 表格", true, undefined],
    ["phone 表格", false, "表格"],
  ])(
    "shows the empty wording exactly once in %s",
    async (_name, desktop, view) => {
      matchMedia(desktop);
      const wrapper = mountPending(freshSite(), true);
      await flushPromises();
      if (view) await clickView(wrapper, view);
      await flushPromises();
      expect(countOf(wrapper, "没有符合条件的记录")).toBe(1);
    },
  );

  it("mounts the DataTable on phones in 表格 without list-only chrome", async () => {
    matchMedia(false);
    const wrapper = mountPending(freshSite());
    await flushPromises();
    expect(wrapper.find(".pending-phone-card").exists()).toBe(true);
    await clickView(wrapper, "表格");
    await flushPromises();
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.find(".pending-phone-card").exists()).toBe(false);
    expect(wrapper.findComponent(BrowseLoadMore).exists()).toBe(false);
  });
});

describe("损坏待处理 更多 sheet", () => {
  beforeEach(clampedLines);
  afterEach(() => vi.restoreAllMocks());

  it("lists every visible field from a phone row, and 打开 opens the row's item", async () => {
    const site = freshSite();
    matchMedia(false);
    const wrapper = mountPending(site);
    await flushPromises();
    // 库位 is hidden by default, so show it before the sheet is measured.
    preferences(wrapper).toggle("warehouse_label");
    await flushPromises();
    await wrapper
      .get(".pending-phone-card button.card-fields-more")
      .trigger("click");
    await flushPromises();
    expect(sheetLabels()).toEqual(
      expect.arrayContaining(["物品名称", "批次编号", "库位"]),
    );
    const page = wrapper.findComponent(PendingPage);
    expect(page.emitted("item")).toBeUndefined();
    sheetOpenButton().click();
    await flushPromises();
    expect(page.emitted("item")).toEqual([["ITEM-A"]]);
    expect(document.querySelector(".row-fields-sheet")).toBeNull();
  });
});
