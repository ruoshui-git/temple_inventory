// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick, h } from "vue";
import PreviewInventory from "./support/FixtureHostInventory.vue";
import PreviewReceive from "./support/FixtureHostReceive.vue";
import PreviewOverlay from "../src/components/ui/Overlay.vue";
import PreviewStockDetails from "../src/components/StockDetails.vue";
import PreviewItemImage from "./support/FixtureHostItemImage.vue";
import PreviewBrowsePages from "./support/FixtureHostBrowsePages.vue";
import { items } from "./support/model";
import { RouterLinkStub } from "./support/RouterLinkStub";

const mounted: VueWrapper[] = [];
function render(component: any, props: Record<string, unknown> = {}) {
  const wrapper = mount(component, {
    props,
    attachTo: document.body,
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
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
    const parentOverlay = document.querySelector<HTMLElement>(".ui-overlay")!;
    const imageButton =
      parentOverlay.querySelector<HTMLButtonElement>(".item-image-button")!;
    imageButton.focus();
    imageButton.click();
    await nextTick();
    await nextTick();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    expect(document.querySelectorAll(".ui-overlay")).toHaveLength(2);
    const parentDialog = document.querySelector<HTMLElement>(".ui-dialog")!;
    const top = document.querySelectorAll<HTMLElement>(".ui-dialog")[1]!;
    top.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(document.querySelectorAll(".ui-overlay")).toHaveLength(1);
    expect(parentDialog.isConnected).toBe(true);
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
    expect(wrapper.findAll(".form-section")[0].text()).toContain(
      "确认时自动记录当前时间",
    );
    expect(
      wrapper.findAll(".form-section")[0]!.find('input[type="date"]').exists(),
    ).toBe(false);
    await wrapper.get(".current-time-note button").trigger("click");
    await flushPromises();
    const date = wrapper.findAll(".form-section")[0].get('input[type="date"]');
    await date.setValue("2026-10-12");
    await wrapper.setProps({ pattern: "current" });
    expect((date.element as HTMLInputElement).value).toBe("2026-10-12");
    expect(wrapper.findAll(".operation-compact-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("GALLERY-RECEIVE");
  });
  it("preserves the active filters when opening contextual export", async () => {
    const wrapper = render(PreviewInventory, { pattern: "current" });
    await flushPromises();
    await wrapper.get('input[aria-label="搜索库存"]').setValue("珍珠米");
    await vi.waitFor(() => expect(wrapper.findAll("tbody tr")).toHaveLength(1));
    await flushPromises();
    await wrapper.get('[aria-label="更多操作"]').trigger("click");
    document
      .querySelector<HTMLButtonElement>(".popup-menu-panel button")!
      .click();
    await nextTick();
    await flushPromises();
    expect(document.querySelector(".ui-dialog")?.textContent).toContain(
      "1 行完整结果",
    );
    expect(document.querySelector(".ui-dialog")?.textContent).toContain(
      "珍珠米",
    );
    document
      .querySelector<HTMLButtonElement>(
        '.ui-dialog button[aria-label="关闭对话框"]',
      )!
      .click();
    await nextTick();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });
  it("filters, sorts, and keeps selected-item actions available across views and breakpoints", async () => {
    const wrapper = render(PreviewInventory, { pattern: "proposed" });
    await flushPromises();
    expect(wrapper.get(".browse-header-actions").text()).toContain("新建物品");
    await wrapper.get('input[aria-label="选择东北珍珠米"]').setValue(true);
    await button(wrapper, "列表").trigger("click");
    expect(wrapper.findAll("tbody tr.selected")).toHaveLength(1);
    expect(wrapper.find('select[aria-label="库存排序"]').exists()).toBe(false);
    const availableHeader = wrapper
      .findAll(".data-table-sort")
      .find((button) => button.text().includes("可用"))!;
    await availableHeader.trigger("click");
    expect(
      availableHeader.element.closest("th")?.getAttribute("aria-sort"),
    ).toBe("ascending");
    await wrapper.get('input[aria-label="搜索库存"]').setValue("长袖");
    await vi.waitFor(() => expect(wrapper.findAll("tbody tr")).toHaveLength(1));
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get(".selection-bar").text()).toContain("已选择 1 项");
    desktop = false;
    listeners.forEach((callback) => callback({ matches: false }));
    await flushPromises();
    expect(wrapper.find('[aria-label="新建操作"]').exists()).toBe(false);
    expect(wrapper.get(".browse-mobile-actions").exists()).toBe(true);
    expect(
      document.body.querySelector(".browse-split-button")?.textContent,
    ).toContain("新建物品");
    expect(wrapper.find(".browse-tools-toggle").exists()).toBe(false);
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
    const qty = wrapper.get('.operation-compact-row input[data-field="qty"]');
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
      document.querySelectorAll<HTMLButtonElement>(".ui-dialog button"),
    ).find((node) => node.textContent?.trim() === "确认提交")!;
    expect(confirm).toBeDefined();
    confirm.click();
    await flushPromises();
    expect(wrapper.text()).toContain("已提交");
    expect(
      wrapper.find('.operation-compact-row input[data-field="qty"]').exists(),
    ).toBe(false);
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
