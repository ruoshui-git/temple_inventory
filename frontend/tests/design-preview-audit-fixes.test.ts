import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper, DOMWrapper } from "@vue/test-utils";
import { KeepAlive, nextTick, ref } from "vue";
import { usePreviewFocusVisibility } from "../src/design-preview/focusVisibility";
import PreviewApp from "../src/design-preview/PreviewApp.vue";
import PreviewInventory from "../src/design-preview/PreviewInventory.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewCountSummary from "../src/design-preview/components/PreviewCountSummary.vue";
import PreviewReturnToTop from "../src/design-preview/components/PreviewReturnToTop.vue";
import {
  countLocationLines,
  countSummary,
  refreshCountBaseline,
} from "../src/design-preview/workflowModel";
import {
  createDraft,
  resetReviewSession,
  reviewSession,
  pageHash,
} from "../src/design-preview/reviewModel";
import {
  previewScrollOwner,
  usePreviewScroll,
} from "../src/design-preview/scroll";
let wrapper: VueWrapper;
let y = 0;
beforeEach(() => {
  resetReviewSession();
  localStorage.clear();
  y = 0;
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  vi.spyOn(window, "scrollTo").mockImplementation((options: any) => {
    y = options.top || 0;
    window.dispatchEvent(new Event("scroll"));
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  await nextTick();
  await nextTick();
}
async function route(key: Parameters<typeof pageHash>[0]) {
  window.history.replaceState(null, "", pageHash(key));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await settle();
}
function button(scope: VueWrapper | DOMWrapper<Element>, name: string) {
  return scope.findAll("button").find((row) => row.text().trim() === name)!;
}

describe("preview audit repairs", () => {
  it("keeps focused browse tools available while the header compresses and expands", async () => {
    wrapper = mount(PreviewInventory, {
      props: { pattern: "current", active: true },
      slots: { "context-actions": "<button>盘点调整</button>" },
      attachTo: document.body,
    });
    await settle();
    const results = wrapper.get(".results-region").element;
    vi.spyOn(results, "getBoundingClientRect").mockImplementation(
      () => ({ top: 400 - y }) as DOMRect,
    );
    const sort = wrapper.get('select[aria-label="库存排序"]')
      .element as HTMLElement;
    sort.focus();
    y = 1000;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(wrapper.classes()).toContain("is-compact");
    expect(button(wrapper, "浏览工具").attributes("aria-expanded")).toBe(
      "true",
    );
    expect(wrapper.get("#inventory-secondary-tools").isVisible()).toBe(true);
    expect(document.activeElement).toBe(sort);
    (button(wrapper, "浏览工具").element as HTMLElement).focus();
    y = 0;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(wrapper.classes()).not.toContain("is-compact");
    expect(document.activeElement).toBe(
      wrapper.get("#inventory-secondary-tools button").element,
    );
    (button(wrapper, "盘点调整").element as HTMLElement).focus();
    y = 1000;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(document.activeElement).toBe(button(wrapper, "盘点调整").element);
    y = 0;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(document.activeElement).toBe(button(wrapper, "盘点调整").element);
  });
  it("owns one observer across KeepAlive mounting, reactivation and breakpoint changes", async () => {
    const observers: { connected: boolean; callback: () => void }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        state: (typeof observers)[number];
        constructor(callback: () => void) {
          this.state = { connected: false, callback };
          observers.push(this.state);
        }
        observe() {
          this.state.connected = true;
        }
        disconnect() {
          this.state.connected = false;
        }
      },
    );
    const shown = ref(true);
    const mobile = ref(true);
    const Surface = {
      setup() {
        const root = ref<HTMLElement>();
        const review = ref<HTMLElement>();
        usePreviewFocusVisibility(
          root,
          review,
          () => mobile.value,
          () => true,
        );
        usePreviewScroll(root);
        return { root, review };
      },
      template: '<section ref="root"><input /><aside ref="review" /></section>',
    };
    wrapper = mount(
      {
        components: { KeepAlive, Surface },
        setup: () => ({ shown }),
        template: '<KeepAlive><Surface v-if="shown" /></KeepAlive>',
      },
      { attachTo: document.body },
    );
    await settle();
    expect(observers).toHaveLength(1);
    expect(observers.filter((row) => row.connected)).toHaveLength(1);
    shown.value = false;
    await settle();
    expect(observers.filter((row) => row.connected)).toHaveLength(0);
    shown.value = true;
    await settle();
    expect(observers.filter((row) => row.connected)).toHaveLength(1);
    mobile.value = false;
    await settle();
    expect(observers.filter((row) => row.connected)).toHaveLength(1);
    wrapper.unmount();
    expect(observers.filter((row) => row.connected)).toHaveLength(0);
  });
  it("separates the full baseline from reviewed zero, not-found and mixed-unit differences", () => {
    const draft = createDraft("Reconcile");
    draft.lines = countLocationLines("斋堂 / A-01");
    expect(countSummary(draft)).toMatchObject({
      baseline: [["袋", 80]],
      reviewed: 0,
      total: 3,
      unreviewed: 3,
      actual: [],
      difference: [],
    });
    draft.lines[0].countedQty = 0;
    expect(countSummary(draft)).toMatchObject({
      baseline: [["袋", 80]],
      reviewed: 1,
      actual: [["袋", 0]],
      difference: [["袋", -60]],
      unreviewed: 2,
    });
    draft.lines.push({
      id: "mixed",
      code: "ITM-000129",
      qty: 2,
      countedQty: 3,
      uom: "桶",
      location: "斋堂 / A-01",
    });
    draft.lines[1].countedQty = draft.lines[1].qty;
    draft.lines[2].countedQty = 0;
    draft.lines[2].countState = "not_found";
    expect(countSummary(draft)).toMatchObject({
      reviewed: 4,
      actual: [
        ["袋", draft.lines[1].qty],
        ["桶", 3],
      ],
      difference: [
        ["袋", -60 - draft.lines[2].qty],
        ["桶", 1],
      ],
    });
    wrapper = mount(PreviewCountSummary, { props: { draft } });
    expect(wrapper.text()).toContain("账面合计");
    expect(wrapper.text()).toContain("已核对实点合计");
    expect(wrapper.text()).toContain("本次调整差异");
  });
  it("keeps actual input during baseline refresh and recomputes differences before re-review", () => {
    const draft = createDraft("Reconcile");
    draft.countLocation = "斋堂 / A-01";
    draft.countMode = "full";
    draft.lines = countLocationLines(draft.countLocation);
    draft.lines[0].countedQty = 0;
    reviewSession.stock.find(
      (row) => row.code === draft.lines[0].code,
    )!.locations[0].batches![0].available = 65;
    refreshCountBaseline(draft);
    expect(draft.lines[0].countedQty).toBe(0);
    expect(draft.baselineReviewed).toBe(false);
    expect(countSummary(draft)).toMatchObject({
      actual: [["袋", 0]],
      difference: [["袋", -65]],
      unreviewed: 2,
    });
  });
  it("shows scoped quantities in confirmation and after explicit submission", async () => {
    const draft = createDraft("Reconcile");
    draft.countLocation = "斋堂 / A-01";
    draft.lines = countLocationLines(draft.countLocation);
    reviewSession.selectedDraftName = draft.name;
    wrapper = mount(PreviewFormPages, {
      props: { page: "reconciliation-form", variant: "new" },
      attachTo: document.body,
    });
    await settle();
    expect(wrapper.get(".count-difference").text()).toContain("尚未核对");
    draft.lines[0].countedQty = 0;
    draft.lines[0].reason = "核对";
    await settle();
    await button(wrapper.get(".form-review"), "复核并确认").trigger("click");
    const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!);
    expect(dialog.text()).toContain("2 行未核对，不纳入调整");
    expect(dialog.text()).toContain("80 袋");
    expect(dialog.text()).toContain("0 袋");
    expect(dialog.text()).toContain("−60 袋");
    await button(dialog, "确认提交").trigger("click");
    expect(draft.status).toBe("completed");
    expect(wrapper.get(".count-difference").text()).toContain("−60 袋");
    await button(wrapper.get(".form-review"), "查看盘点汇总").trigger("click");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "账面合计",
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("确认提交");
  });
  it("restores document and nested table positions, but resets ordinary Inventory navigation", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await route("inventory/list");
    const input = wrapper.get('input[aria-label="搜索物品或条码"]');
    await input.setValue("珍珠米");
    await wrapper.get('input[aria-label="选择东北珍珠米"]').setValue(true);
    await button(wrapper, "列表").trigger("click");
    const table = wrapper.get(".table-scroll").element as HTMLElement;
    table.scrollLeft = 93;
    y = 600;
    await button(wrapper, "东北珍珠米").trigger("click");
    await settle();
    expect(y).toBe(0);
    y = 260;
    await button(wrapper, "← 返回上一页").trigger("click");
    await settle();
    expect(y).toBe(600);
    expect(table.scrollLeft).toBe(93);
    expect((input.element as HTMLInputElement).value).toBe("珍珠米");
    expect(
      (
        wrapper.get('input[aria-label="选择东北珍珠米"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true);
    await wrapper
      .findAll(".nav-children button")
      .find((row) => row.text() === "库存列表")!
      .trigger("click");
    await settle();
    expect(y).toBe(0);
    expect(table.scrollLeft).toBe(0);
  });
  it("uses an actual scrollable ancestor and falls back to the document", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.append(child);
    document.body.append(parent);
    parent.style.overflowY = "auto";
    Object.defineProperties(parent, {
      scrollHeight: { value: 900 },
      clientHeight: { value: 300 },
    });
    expect(previewScrollOwner(child)).toBe(parent);
    parent.style.overflowY = "visible";
    expect(previewScrollOwner(child)).toBe(window);
  });
  it("crosses the two-viewport threshold in both directions and releases inactive listeners", async () => {
    wrapper = mount(PreviewReturnToTop, { attachTo: document.body });
    await settle();
    y = innerHeight * 2;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(wrapper.find("button").exists()).toBe(false);
    y++;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(wrapper.find("button").exists()).toBe(true);
    await wrapper.setProps({ hidden: true });
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.setProps({ hidden: false });
    y = 0;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.setProps({ active: false });
    y = innerHeight * 3;
    window.dispatchEvent(new Event("scroll"));
    await wrapper.setProps({ active: true });
    await settle();
    expect(wrapper.find("button").exists()).toBe(true);
  });
  it("returns to the browse origin when the heading is pinned by compact chrome", async () => {
    y = innerHeight * 3;
    const move = vi
      .spyOn(window, "scrollBy")
      .mockImplementation((options: any) => {
        y += options.top;
        window.dispatchEvent(new Event("scroll"));
      });
    wrapper = mount(
      {
        components: { PreviewReturnToTop },
        template:
          '<div class="inventory-example"><h1>库存</h1><PreviewReturnToTop /></div>',
      },
      { attachTo: document.body },
    );
    vi.spyOn(wrapper.element, "getBoundingClientRect").mockImplementation(
      () => ({ top: 500 - y }) as DOMRect,
    );
    vi.spyOn(
      wrapper.get("h1").element,
      "getBoundingClientRect",
    ).mockImplementation(() => ({ top: 40 }) as DOMRect);
    await settle();
    await wrapper.get("button").trigger("click");
    expect(move).toHaveBeenCalled();
    expect(y).toBe(488);
    expect(document.activeElement).toBe(wrapper.get("h1").element);
    await settle();
    expect(wrapper.find("button").exists()).toBe(false);
  });
  it("reveals a focused control above a floating creation action and stops when inactive", async () => {
    vi.useFakeTimers();
    const move = vi
      .spyOn(window, "scrollBy")
      .mockImplementation((options: any) => {
        y += options.top;
      });
    wrapper = mount(
      {
        setup() {
          const root = ref<HTMLElement>();
          const active = ref(true);
          usePreviewFocusVisibility(
            root,
            ref<HTMLElement>(),
            () => false,
            () => active.value,
          );
          return { root, active };
        },
        template:
          '<div ref="root"><button class="field">放大图片</button><div class="current-fab"><button>新建</button></div><button @click="active = false">隐藏页面</button></div>',
      },
      { attachTo: document.body },
    );
    const field = wrapper.get(".field").element as HTMLElement;
    const action = wrapper.get(".current-fab button").element;
    vi.spyOn(field, "getBoundingClientRect").mockImplementation(
      () =>
        ({ top: 650 - y, bottom: 694 - y, left: 290, right: 334 }) as DOMRect,
    );
    vi.spyOn(action, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    vi.spyOn(action, "getBoundingClientRect").mockReturnValue({
      top: 668,
      bottom: 720,
      left: 303,
      right: 355,
    } as DOMRect);
    await settle();
    field.focus();
    await vi.advanceTimersByTimeAsync(20);
    expect(field.getBoundingClientRect().bottom).toBeLessThanOrEqual(656);
    await wrapper.findAll("button")[2]!.trigger("click");
    move.mockClear();
    y = 0;
    field.blur();
    field.focus();
    await vi.advanceTimersByTimeAsync(20);
    expect(move).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
