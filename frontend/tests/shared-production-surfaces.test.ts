import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick, h } from "vue";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import PreviewInventory from "./support/FixtureHostInventory.vue";
import PreviewReceive from "./support/FixtureHostReceive.vue";
import PreviewOverlay from "../src/components/ui/Overlay.vue";
import PreviewStockDetails from "../src/components/StockDetails.vue";
import PreviewItemImage from "./support/FixtureHostItemImage.vue";
import PreviewBrowsePages from "./support/FixtureHostBrowsePages.vue";
import { pageHash } from "./support/reviewModel";
import {
  defaults,
  filterItems,
  expiryStatus,
  itemBatches,
  items,
  preferenceKey,
  quantities,
  readPreferences,
  themes,
  validateLines,
  writePreferences,
} from "./support/model";

const mounted: VueWrapper[] = [];
function render(component: any, props: Record<string, unknown> = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper, text: string) {
  const result = wrapper
    .findAll("button")
    .find((element) => element.text() === text);
  if (!result) throw new Error(`Button not found: ${text}`);
  return result;
}
let desktop = true;
const listeners = new Set<(event: { matches: boolean }) => void>();
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  desktop = true;
  listeners.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("max-width") ? !desktop : desktop;
      },
      addEventListener: (
        _: string,
        handler: (event: { matches: boolean }) => void,
      ) => listeners.add(handler),
      removeEventListener: (
        _: string,
        handler: (event: { matches: boolean }) => void,
      ) => listeners.delete(handler),
    })),
  );
});
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("design preview preferences and fixtures", () => {
  it("keeps legacy density while adopting jade and current workflow defaults", () => {
    localStorage.setItem(
      "ti:design-preview:v1",
      JSON.stringify({
        theme: "jade",
        density: "compact",
        navigation: "current",
        actions: "proposed",
        form: "current",
      }),
    );
    expect(readPreferences(localStorage)).toEqual({
      ...defaults,
      theme: "jade",
      density: "compact",
    });
  });
  it("does not carry legacy palette, navigation, or proposed workflow into the approved defaults", () => {
    localStorage.setItem(
      "ti:design-preview:v2",
      JSON.stringify({
        theme: "bronze",
        density: "spacious",
        navigation: "proposed",
        form: "proposed",
      }),
    );
    expect(readPreferences(localStorage)).toEqual({
      ...defaults,
      density: "spacious",
    });
  });
  it("scopes item totals and distinct batches to the selected locations", () => {
    const rice = items[0];
    expect(rice.locations).toHaveLength(3);
    expect(rice.locations.reduce((sum, row) => sum + row.available, 0)).toBe(
      128,
    );
    expect(itemBatches(rice).map((batch) => batch.available)).toEqual([92, 36]);
    const scoped = filterItems(rice.code, ["斋堂 / A-02"], "")[0];
    expect(scoped.locations).toHaveLength(1);
    expect(scoped.available).toBe(32);
    expect(itemBatches(scoped)).toHaveLength(1);
    const parentAndChild = filterItems(
      rice.code,
      ["斋堂", "斋堂 / A-01"],
      "",
    )[0];
    expect(parentAndChild.available).toBe(112);
    expect(parentAndChild.locations).toHaveLength(2);
    expect(rice.available).toBe(128);
  });
  it("keeps batch tracking independent of expiry tracking", () => {
    const plain = items[2];
    const batchOnly = items[5];
    expect(itemBatches(plain)).toEqual([]);
    expect(expiryStatus(plain)).toBeNull();
    expect(itemBatches(batchOnly)).toHaveLength(1);
    expect(expiryStatus(batchOnly)).toBeNull();
    expect(expiryStatus(items[0])).toBe("未过期");
    expect(expiryStatus(items[1])).toBe("未过期");
    expect(expiryStatus(items[4])).toBe("已过期");
    const line = {
      id: 1,
      code: plain.code,
      location: plain.locations[0].location,
      qty: 2,
      batch: "",
      expiry: "",
    };
    expect(validateLines([line])).toBe("");
    expect(
      validateLines([{ ...line, code: batchOnly.code, batch: "TEXTILE-DEMO" }]),
    ).toBe("");
    expect(validateLines([{ ...line, code: batchOnly.code }])).toContain(
      "批次编号",
    );
    expect(
      validateLines([{ ...line, code: items[0].code, batch: "RICE-DEMO" }]),
    ).toContain("到期日期");
  });
  it("validates persisted choices and survives inaccessible or corrupt storage", () => {
    expect(readPreferences(undefined)).toEqual(defaults);
    expect(readPreferences({ getItem: () => "not json" })).toEqual(defaults);
    expect(readPreferences({ getItem: () => "null" })).toEqual(defaults);
    expect(
      readPreferences({
        getItem: () => '{"theme":"unknown","density":"tiny"}',
      }),
    ).toEqual(defaults);
    expect(
      readPreferences({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(defaults);
    expect(() =>
      writePreferences(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        defaults,
      ),
    ).not.toThrow();
    const choices = {
      ...defaults,
      theme: "jade" as const,
      density: "spacious" as const,
    };
    writePreferences(localStorage, choices);
    expect(readPreferences(localStorage)).toEqual(choices);
    expect(Object.keys(localStorage)).toEqual([preferenceKey]);
  });
  it("filters by ancestor, category and search, and sums quantities per unit", () => {
    expect(filterItems("", ["斋堂"], "食品")).toHaveLength(3);
    expect(
      filterItems("ITM-000128", ["斋堂 / A-01"], "食品").map(
        (item) => item.name,
      ),
    ).toEqual(["东北珍珠米"]);
    expect(filterItems("不存在", [], "")).toEqual([]);
    expect(quantities(items)).toEqual([
      { uom: "袋", qty: 128 },
      { uom: "桶", qty: 36 },
      { uom: "件", qty: 82 },
      { uom: "个", qty: 48 },
    ]);
  });
  it("requires positive finite quantities and batch fields without rejecting expired donations", () => {
    const line = {
      id: 1,
      code: items[0].code,
      qty: 1,
      location: items[0].locations[0].location,
      batch: "DEMO",
      expiry: "2026-01-01",
    };
    expect(validateLines([line])).toBe("");
    expect(validateLines([])).not.toBe("");
    expect(validateLines([{ ...line, qty: 0 }])).not.toBe("");
    expect(validateLines([{ ...line, qty: NaN }])).not.toBe("");
    expect(validateLines([{ ...line, batch: " " }])).not.toBe("");
    expect(validateLines([{ ...line, location: "invalid" }])).not.toBe("");
  });
});

describe("interactive preview", () => {
  it("shows thumbnails in every list row and no expiry badge for undated items", async () => {
    const wrapper = render(PreviewInventory, { pattern: "current" });
    await flushPromises();
    const plainRow = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes(items[2].name))!;
    expect(plainRow.find(".badge").exists()).toBe(false);
    expect(plainRow.find(".table-item-image").exists()).toBe(true);
    expect(wrapper.findAll("tbody .table-item-image")).toHaveLength(
      items.length,
    );
    await button(wrapper, "卡片").trigger("click");
    const plainCard = wrapper
      .findAll(".stock-card")
      .find((card) => card.text().includes(items[2].name))!;
    expect(plainCard.find(".art-badge").exists()).toBe(false);
    expect(plainCard.text()).not.toContain("批次");
    await button(wrapper, "列表").trigger("click");
    expect(wrapper.findAll("tbody .table-item-image")).toHaveLength(
      items.length,
    );
    const plainRowAfter = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes(items[2].name))!;
    expect(plainRowAfter.find(".badge").exists()).toBe(false);
    expect(
      wrapper.findAll(".table-item-image .item-image-button"),
    ).toHaveLength(5);
    await wrapper
      .get('button[aria-label="放大查看东北珍珠米图片"]')
      .trigger("click");
    await flushPromises();
    expect(document.querySelector(".lightbox-image")).not.toBeNull();
    document
      .querySelector<HTMLElement>(".preview-overlay")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await flushPromises();
    expect(document.querySelector(".lightbox-image")).toBeNull();
    expect(wrapper.findAll("tbody tr")).toHaveLength(6);
  });
  it("opens location breakdowns on hover, supports pinned click, and dismisses with Escape", async () => {
    const wrapper = render(PreviewStockDetails, { item: items[0] });
    await nextTick();
    const trigger = wrapper.get(
      'button[aria-label="东北珍珠米的库位与可用数量"]',
    );
    expect(trigger.text()).toContain("3 个库位");
    await trigger.trigger("mouseenter");
    await nextTick();
    expect(document.querySelectorAll(".stock-breakdown tbody tr")).toHaveLength(
      3,
    );
    expect(
      document.querySelector(".stock-breakdown-total")?.textContent,
    ).toContain("128 袋");
    await trigger.trigger("click");
    await trigger.trigger("mouseleave");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(button(wrapper, "2 个批次")).toBeDefined();
  });
  it("restores the underlying dialog when its image lightbox closes", async () => {
    const wrapper = mount(PreviewOverlay, {
      props: { title: "物品详情" },
      slots: { default: () => h(PreviewItemImage, { item: items[0] }) },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await nextTick();
    const parent = document.querySelector<HTMLElement>(".preview-overlay")!;
    const imageButton =
      parent.querySelector<HTMLButtonElement>(".item-image-button")!;
    imageButton.focus();
    imageButton.click();
    await nextTick();
    await nextTick();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll(".preview-overlay")).toHaveLength(1);
    const top = document.querySelector<HTMLElement>(".overlay-stage")!;
    top.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(document.querySelector(".overlay-stage")).toBeNull();
    expect(document.activeElement).toBe(imageButton);
    expect(document.body.style.overflow).toBe("hidden");
  });
  it("does not offer an image viewer for missing images", () => {
    const wrapper = render(PreviewItemImage, { item: items[4] });
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.text()).toContain("暂无图片");
  });
  it("keeps the native date and allocation editor mounted across receiving layout settings", async () => {
    const wrapper = render(PreviewReceive, { pattern: "proposed" });
    await flushPromises();
    expect(wrapper.find(".form-review").exists()).toBe(true);
    expect(wrapper.findAll(".form-section")[0].text()).toContain("操作日期");
    await wrapper.get("select").setValue("manual");
    const date = wrapper.findAll(".form-section")[0].get('input[type="date"]');
    await date.setValue("2026-10-12");
    await wrapper.setProps({ pattern: "current" });
    expect((date.element as HTMLInputElement).value).toBe("2026-10-12");
    expect(wrapper.findAll(".preview-allocation")).toHaveLength(1);
    expect(wrapper.text()).toContain("GALLERY-RECEIVE");
  });
  it("preserves the active filters when opening contextual export", async () => {
    const wrapper = render(PreviewInventory, { pattern: "current" });
    await flushPromises();
    await wrapper.get('input[aria-label="搜索库存"]').setValue("珍珠米");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    await button(wrapper, "导出").trigger("click");
    await nextTick();
    expect(document.querySelector(".preview-dialog")?.textContent).toContain(
      "1 行完整结果",
    );
    expect(document.querySelector(".preview-dialog")?.textContent).toContain(
      "珍珠米",
    );
    document
      .querySelector<HTMLButtonElement>(
        '.preview-dialog button[aria-label="关闭对话框"]',
      )!
      .click();
    await nextTick();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });
  it("filters, sorts, and keeps selected-item actions available across views and breakpoints", async () => {
    const wrapper = render(PreviewInventory, { pattern: "proposed" });
    await flushPromises();
    await wrapper.get('input[aria-label="选择东北珍珠米"]').setValue(true);
    await button(wrapper, "列表").trigger("click");
    expect(wrapper.findAll("tbody tr.selected")).toHaveLength(1);
    await wrapper.get('select[aria-label="库存排序"]').setValue("available");
    expect(wrapper.get('select[aria-label="库存排序"]').element).toHaveProperty(
      "value",
      "available",
    );
    await wrapper.get('input[aria-label="搜索库存"]').setValue("长袖");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get(".selection-bar").text()).toContain("已选择 1 项");
    desktop = false;
    listeners.forEach((callback) => callback({ matches: false }));
    await flushPromises();
    expect(wrapper.find('[aria-label="新建操作"]').exists()).toBe(false);
    expect(wrapper.get(".browse-expanded-actions").text()).toContain(
      "新建物品",
    );
    expect(wrapper.get(".browse-expanded-actions").text()).not.toContain(
      "入库",
    );
    await button(wrapper, "收起工具").trigger("click");
    expect(wrapper.get(".stock-selection-actions").isVisible()).toBe(true);
    await button(wrapper, "调拨").trigger("click");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-form",
      "Transfer",
    ]);
    await button(wrapper, "取消选择").trigger("click");
    expect(wrapper.find(".stock-selection-actions").exists()).toBe(false);
  });
  it("validates receiving input and confirms through the shared native service contract", async () => {
    const wrapper = render(PreviewReceive, { pattern: "current" });
    await flushPromises();
    const qty = wrapper.get('input[aria-label="东北珍珠米数量"]');
    await qty.setValue(0);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("数量必须大于 0");
    await qty.setValue(7);
    await wrapper.setProps({ pattern: "proposed" });
    expect((qty.element as HTMLInputElement).value).toBe("7");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".preview-dialog button"),
    ).find((node) => node.textContent?.trim() === "确认提交")!;
    expect(confirm).toBeDefined();
    confirm.click();
    await flushPromises();
    expect(wrapper.text()).toContain("已提交");
    expect(wrapper.find('input[aria-label="东北珍珠米数量"]').exists()).toBe(
      false,
    );
  });
  it("traps overlay focus, handles Escape, restores focus and releases scroll locking", async () => {
    const host = document.createElement("div");
    host.dataset.inventoryApp = "";
    const trigger = document.createElement("button");
    host.append(trigger);
    document.body.append(host);
    trigger.focus();
    const wrapper = mount(PreviewOverlay, {
      props: { title: "测试" },
      slots: {
        default:
          '<input aria-label="样本" /><button id="last-button">最后</button>',
      },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await nextTick();
    await nextTick();
    expect(host.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const first = panel.querySelector<HTMLButtonElement>("button")!;
    const last = panel.querySelector<HTMLButtonElement>("#last-button")!;
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(last);
    panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);
    await flushPromises();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
    expect(host.inert).toBe(false);
  });
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "");
    const channels = [0, 2, 4]
      .map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
describe("preview palette contrast", () => {
  for (const theme of themes) {
    it(`${theme.id} supports readable text, selected states and focus indicators`, () => {
      for (const surface of ["#FFFFFF", theme.canvas, theme.soft]) {
        expect(contrast(theme.ink, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.muted, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.accent, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast("#FFFFFF", theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#FFFFFF", theme.strong)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.border, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    });
  }
  it("keeps semantic status text legible", () => {
    const css = readFileSync("src/styles/foundation.css", "utf8");
    for (const kind of ["success", "warning", "danger", "info"]) {
      const foreground = css.match(
        new RegExp(`--p-${kind}: (#[0-9a-f]{6})`),
      )![1];
      const background = css.match(
        new RegExp(`--p-${kind}-bg: (#[0-9a-f]{6})`),
      )![1];
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
