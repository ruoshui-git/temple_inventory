// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import StockBrowseView from "../src/features/inventory/StockBrowseView.vue";
import { browseLayoutStorageKey } from "../src/composables/useBrowseViewMode";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import type { StockItem } from "../src/lib/stockPresentation";
import { RouterLinkStub } from "./support/RouterLinkStub";
import BrowseLoadMore from "../src/components/ui/BrowseLoadMore.vue";

// Each test gets its own site so column preferences cached by account and site stay isolated.
let siteSequence = 0;
const wrappers: VueWrapper[] = [];

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function viewport(desktop: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches: desktop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function item(changes: Partial<StockItem> = {}): StockItem {
  return {
    code: "ITEM-A",
    name: "大米",
    category: "食品",
    uom: "kg",
    available: 8,
    loaned: 3,
    damaged: 1,
    tracksBatch: true,
    tracksExpiry: true,
    locations: [
      {
        location: "ROOM-A",
        label: "东库",
        available: 8,
        loaned: 3,
        damaged: 1,
        batches: [{ id: "BATCH-A", available: 8, expiry: "2026-10-15" }],
      },
    ],
    ...changes,
  };
}

async function mountStock(site: string, rows: StockItem[] = [item()]) {
  const host = defineComponent({
    setup() {
      const reference = createReferenceData();
      reference.site = site;
      reference.user = "Administrator";
      reference.siteDate = "2026-10-16";
      provideInventoryServices(
        {
          call: vi.fn(async () => ({
            rows,
            matched_count: rows.length,
            next_start: null,
            summary: [],
            snapshot: "2026-10-16",
            analysis: { category: [], location: [] },
          })) as never,
          report: vi.fn(),
          upload: vi.fn(),
        },
        reference,
      );
      return () => h(StockBrowsePage);
    },
  });
  const wrapper = mount(host, {
    attachTo: document.body,
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

interface PreferenceHandle {
  tablePreferences?: { toggle(id: string): void };
}

// The one field selection the three layouts share.
function preferences(wrapper: VueWrapper) {
  const handle = wrapper.findComponent(StockBrowseView)
    .vm as unknown as PreferenceHandle;
  if (!handle.tablePreferences) throw new Error("stock preferences not ready");
  return handle.tablePreferences;
}

async function toggle(wrapper: VueWrapper, id: string) {
  preferences(wrapper).toggle(id);
  await flushPromises();
}

function cardLabels(wrapper: VueWrapper) {
  return wrapper.findAll(".stock-card .card-field dt").map((dt) => dt.text());
}

function rowLabels(wrapper: VueWrapper) {
  return wrapper
    .findAll(".stock-list-row .card-field-label")
    .map((label) => label.text());
}

function tableHeaders(wrapper: VueWrapper) {
  return wrapper.findAll(".data-table th").map((th) => th.text());
}

async function showCards(wrapper: VueWrapper) {
  await wrapper.get('button[aria-label="卡片视图"]').trigger("click");
}

describe("stock card fields", () => {
  it("drives table columns, card fields and phone rows from one field selection", async () => {
    viewport(true);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    expect(tableHeaders(wrapper).some((text) => text.includes("借出"))).toBe(
      false,
    );
    await toggle(wrapper, "loaned");
    expect(tableHeaders(wrapper).some((text) => text.includes("借出"))).toBe(
      true,
    );
    await showCards(wrapper);
    expect(cardLabels(wrapper)).toContain("借出");
    await toggle(wrapper, "loaned");
    expect(cardLabels(wrapper)).not.toContain("借出");
  });

  it("shows a hidden field in phone rows and removes it again", async () => {
    viewport(false);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    expect(rowLabels(wrapper)).toEqual([]);
    await toggle(wrapper, "loaned");
    expect(rowLabels(wrapper)).toEqual(["借出"]);
    expect(wrapper.get(".stock-list-row .card-field-inline").text()).toContain(
      "3",
    );
    await toggle(wrapper, "loaned");
    expect(rowLabels(wrapper)).toEqual([]);
  });

  it("hiding image gives text-only cards and phone rows without a thumbnail", async () => {
    viewport(false);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    expect(wrapper.find(".stock-list-image").exists()).toBe(true);
    await toggle(wrapper, "image");
    expect(wrapper.find(".stock-list-image").exists()).toBe(false);
    await showCards(wrapper);
    expect(wrapper.findAll(".stock-card")).toHaveLength(1);
    expect(wrapper.get(".stock-card").classes()).toContain("is-text-only");
    expect(wrapper.find(".item-card-image").exists()).toBe(false);
    expect(wrapper.get(".item-name").text()).toBe("大米");
  });

  it("hiding available removes the hero quantity and lets the unit show as a field", async () => {
    viewport(false);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    await showCards(wrapper);
    expect(wrapper.find(".stock-number").exists()).toBe(true);
    await toggle(wrapper, "available");
    expect(wrapper.find(".stock-number").exists()).toBe(false);
    expect(cardLabels(wrapper)).toContain("库存单位");
    await wrapper.get('button[aria-label="列表视图"]').trigger("click");
    expect(wrapper.find(".stock-list-quantity").exists()).toBe(false);
  });

  it("always shows the 效期 status badge, and 效期 never appears as a card field", async () => {
    viewport(true);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    await showCards(wrapper);
    expect(wrapper.get(".stock-card .badge").text()).toBe("已过期");
    expect(cardLabels(wrapper)).not.toContain("效期");
    await toggle(wrapper, "expiry");
    expect(wrapper.get(".stock-card .badge").text()).toBe("已过期");
    expect(cardLabels(wrapper)).not.toContain("效期");
  });

  it("offers one 显示字段 button in every layout, and it changes cards and rows", async () => {
    viewport(false);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    expect(wrapper.findAll(".data-table-column-trigger")).toHaveLength(1);
    await wrapper.get(".data-table-column-trigger").trigger("click");
    const loaned = [
      ...document.querySelectorAll<HTMLLabelElement>(
        ".data-table-column-panel label",
      ),
    ].find((label) => label.textContent?.includes("借出"));
    loaned!.querySelector("input")!.click();
    await flushPromises();
    expect(rowLabels(wrapper)).toEqual(["借出"]);
    await showCards(wrapper);
    expect(wrapper.findAll(".data-table-column-trigger")).toHaveLength(1);
    expect(cardLabels(wrapper)).toContain("借出");
  });

  it("offers 列表, 卡片 and 表格 on phones, 表格 and 卡片 on desktops", async () => {
    viewport(false);
    const phone = await mountStock(`site-${++siteSequence}`);
    expect(
      phone.findAll(".stock-view-icons button").map((button) => button.text()),
    ).toEqual(["列表", "卡片", "表格"]);
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    viewport(true);
    const desktop = await mountStock(`site-${++siteSequence}`);
    expect(
      desktop
        .findAll(".stock-view-icons button")
        .map((button) => button.text()),
    ).toEqual(["表格", "卡片"]);
  });

  it("remembers the chosen layout per account and site across remounts", async () => {
    viewport(false);
    const site = `site-${++siteSequence}`;
    const first = await mountStock(site);
    await showCards(first);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          browseLayoutStorageKey(site, "Administrator", "stock"),
        ) || "null",
      ),
    ).toEqual({ phone: "card", desktop: "table" });
    first.unmount();
    wrappers.splice(wrappers.indexOf(first), 1);

    const second = await mountStock(site);
    expect(second.findAll(".stock-card")).toHaveLength(1);
    expect(second.find(".stock-list-row").exists()).toBe(false);
  });
});

// jsdom has no layout: every clamped line reads as cut off, so 更多 shows on each row.
function clampedLines() {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(40);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(20);
}

function layoutButton(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}视图"]`).trigger("click");
}

function openedItems(wrapper: VueWrapper) {
  return wrapper.findComponent(StockBrowsePage).emitted("openItem");
}

describe("stock empty states and layouts", () => {
  it.each([
    ["phone 列表", false, undefined],
    ["phone 卡片", false, "卡片"],
    ["desktop 卡片", true, "卡片"],
    ["desktop 表格", true, undefined],
    ["phone 表格", false, "表格"],
  ])(
    "shows the empty panel exactly once in %s",
    async (_name, desktop, view) => {
      viewport(desktop);
      const wrapper = await mountStock(`site-${++siteSequence}`, []);
      if (view) await layoutButton(wrapper, view);
      await flushPromises();
      expect(wrapper.text().split("没有找到匹配的物品").length - 1).toBe(1);
    },
  );

  it("mounts the DataTable on phones in 表格 and drops the 列表 rows and load-more", async () => {
    viewport(false);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    expect(wrapper.find(".stock-list-row").exists()).toBe(true);
    await layoutButton(wrapper, "表格");
    await flushPromises();
    expect(wrapper.find(".data-table").exists()).toBe(true);
    expect(wrapper.find(".stock-list-row").exists()).toBe(false);
    expect(wrapper.find(".stock-view-icons").exists()).toBe(true);
    expect(wrapper.findComponent(BrowseLoadMore).exists()).toBe(false);
  });
});

describe("stock 更多 sheet", () => {
  beforeEach(clampedLines);
  afterEach(() => vi.restoreAllMocks());

  it("lists every visible field of a phone row, and 打开 opens the same item as the row", async () => {
    viewport(false);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    await wrapper
      .get(".stock-list-row button.card-fields-more")
      .trigger("click");
    await flushPromises();
    expect(openedItems(wrapper)).toBeUndefined();
    const labels = () =>
      Array.from(document.querySelectorAll(".row-fields-sheet dt")).map(
        (dt) => dt.textContent,
      );
    expect(labels()).toEqual(
      expect.arrayContaining(["物品名称", "物品编号", "可用数量"]),
    );
    expect(labels()).not.toContain("借出");
    expect(document.querySelector(".row-fields-sheet")?.textContent).toContain(
      "大米",
    );
    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "打开",
    );
    open!.click();
    await flushPromises();
    expect(openedItems(wrapper)).toEqual([["ITEM-A"]]);
    expect(document.querySelector(".row-fields-sheet")).toBeNull();
    await wrapper.get(".stock-list-open").trigger("click");
    expect(openedItems(wrapper)).toEqual([["ITEM-A"], ["ITEM-A"]]);
  });

  it("opens from a desktop card's 更多 without opening the item", async () => {
    viewport(true);
    const wrapper = await mountStock(`site-${++siteSequence}`);
    await layoutButton(wrapper, "卡片");
    await flushPromises();
    await wrapper.get(".stock-card button.card-fields-more").trigger("click");
    await flushPromises();
    expect(openedItems(wrapper)).toBeUndefined();
    expect(document.querySelector(".row-fields-sheet")).not.toBeNull();
  });
});
