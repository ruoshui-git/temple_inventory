import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOMWrapper,
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import PreviewFilterPanel from "../src/components/ui/FilterPanel.vue";
import BrowseToolbar from "../src/components/ui/BrowseToolbar.vue";
import PreviewCompactFilters from "../src/components/filters/CompactFilters.vue";
import { emptyScope, type BrowseScope } from "../src/lib/browseQuery";
import { provideGalleryReference } from "./support/fixtureReference";
import { resetReviewSession, reviewSession } from "./support/reviewModel";
const wrappers: VueWrapper[] = [];
it.each([true, false])(
  "compact filter shortcut opens a panel without clearing scope (desktop=%s)",
  async (wide) => {
    desktop = wide;
    const scope = ref({ ...emptyScope(), categories: ["food"] });
    const cleared = vi.fn();
    const host = await render(
      defineComponent({
        setup() {
          const filters = ref<InstanceType<typeof PreviewCompactFilters>>();
          return () =>
            h(
              BrowseToolbar,
              { summary: "借用 · 2", onFilters: () => filters.value?.show() },
              {
                default: () =>
                  h(PreviewCompactFilters, {
                    ref: filters,
                    modelValue: scope.value,
                    "onUpdate:modelValue": (value: BrowseScope) =>
                      (scope.value = value),
                    onClear: cleared,
                  }),
              },
            );
        },
      }),
    );
    await button(host, "收起工具").trigger("click");
    await button(host, "筛选").trigger("click");
    await settle();
    expect(body().findAll('[role="dialog"]')).toHaveLength(1);
    expect(scope.value.categories).toEqual(["food"]);
    expect(cleared).not.toHaveBeenCalled();
  },
);
const body = () => new DOMWrapper(document.body);
const dialog = () => body().get('[role="dialog"]');
const button = (scope: VueWrapper | DOMWrapper<Element>, label: string) =>
  scope
    .findAll("button")
    .find((row) => row.text().replace(/\s+/g, " ").trim().startsWith(label))!;
const field = (scope: VueWrapper | DOMWrapper<Element>, label: string) =>
  scope.findAll("label").find((row) => row.text().trim().startsWith(label))!;
const settle = async () => {
  await flushPromises();
  await nextTick();
  await nextTick();
};
async function render(component: unknown, props = {}, slots = {}) {
  const host = defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) {
      provideGalleryReference();
      return () => h(component as never, attrs, slots);
    },
  });
  const root = mount(host, { props, attachTo: document.body });
  wrappers.push(root);
  await settle();
  return root;
}
let desktop = true;
let listeners: Set<(event: { matches: boolean }) => void>;
function resize(value: boolean) {
  desktop = value;
  for (const listener of [...listeners]) listener({ matches: value });
}
beforeEach(() => {
  resetReviewSession();
  desktop = true;
  listeners = new Set();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return desktop;
      },
      addEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => listeners.add(listener),
      removeEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => listeners.delete(listener),
    })),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("bounded filter dialogs", () => {
  it("opens from a focused trigger, coordinates panels, dismisses outside and restores focus on Done/Escape", async () => {
    // Panels share one Vue app in the preview. Separate test apps restart useId(),
    // which would give both panels the same coordination owner and DOM IDs.
    const host = await render(
      defineComponent({
        components: { PreviewFilterPanel },
        template:
          '<div><PreviewFilterPanel label="位置"><input aria-label="测试输入" /></PreviewFilterPanel><PreviewFilterPanel label="类别" /></div>',
      }),
    );
    const first = host.findAllComponents(PreviewFilterPanel)[0]!;
    const second = host.findAllComponents(PreviewFilterPanel)[1]!;
    const trigger = first.get("button");
    trigger.element.focus();
    await trigger.trigger("click");
    await settle(); // Placement must become visible before the browser can accept focus.
    expect(dialog().attributes("aria-modal")).toBeUndefined();
    expect(document.activeElement).toBe(dialog().element);
    await button(second, "类别").trigger("click");
    await settle();
    expect(body().findAll('[role="dialog"]')).toHaveLength(1);
    expect(first.get("button").attributes("aria-expanded")).toBe("false");
    await dialog().trigger("keydown", { key: "Escape" });
    expect(document.activeElement).toBe(second.get("button").element);
    await trigger.trigger("click");
    await button(dialog(), "完成").trigger("click");
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await body().trigger("pointerdown");
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await trigger.trigger("click");
    const done = button(dialog(), "完成");
    done.element.focus();
    await done.trigger("keydown", { key: "Tab" });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });
  it("clamps first-open geometry, follows resize/scroll/content and disconnects observers/listeners", async () => {
    const observers: Array<{
      callback: () => void;
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: () => void;
        disconnect = vi.fn();
        observe = vi.fn();
        constructor(callback: () => void) {
          this.callback = callback;
          observers.push(this);
        }
      },
    );
    const removed = vi.spyOn(document, "removeEventListener");
    const windowRemoved = vi.spyOn(window, "removeEventListener");
    let anchorLeft = 10000;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return {
          left: this.matches("button") ? anchorLeft : 0,
          top: 600,
          bottom: 644,
          height: this.matches("section") ? 500 : 44,
          width: 400,
          right: 10400,
          x: 0,
          y: 0,
          toJSON() {},
        };
      });
    const wrapper = await render(PreviewFilterPanel, { label: "位置" });
    await button(wrapper, "位置").trigger("click");
    const panel = dialog().element as HTMLElement;
    expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(
      window.innerWidth - 412,
    );
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(12);
    expect(panel.style.visibility).not.toBe("hidden");
    anchorLeft = 24;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(panel.style.left).toBe("24px");
    anchorLeft = 36;
    observers[0]!.callback();
    await settle();
    expect(panel.style.left).toBe("36px");
    anchorLeft = 48;
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(panel.style.left).toBe("48px");
    wrapper.unmount();
    wrappers.pop();
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith(
      "preview-filter-panel-open",
      expect.any(Function),
    );
    expect(removed).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(windowRemoved).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true,
    );
    expect(listeners.size).toBe(0);
    rect.mockRestore();
  });
  it("mobile sheet traps focus, locks scroll and returns focus without undoing immediate filters", async () => {
    desktop = false;
    const scope = ref(emptyScope());
    const wrapper = await render(
      defineComponent({
        setup: () => () =>
          h(PreviewCompactFilters, {
            modelValue: scope.value,
            "onUpdate:modelValue": (value) => (scope.value = value),
            movement: true,
            records: true,
            resultCount: scope.value.kinds.length ? 0 : 100,
          }),
      }),
    );
    const trigger = button(wrapper, "筛选");
    trigger.element.focus();
    await trigger.trigger("click");
    await settle();
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog().text()).toContain("100 项结果");
    await field(dialog(), "出库").get("input").setValue(true);
    expect(scope.value.kinds).toEqual(["Issue"]);
    expect(dialog().text()).toContain("0 项结果");
    const done = button(dialog(), "完成");
    done.element.focus();
    await done.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(button(dialog(), "关闭").element);
    await button(dialog(), "完成").trigger("click");
    expect(scope.value.kinds).toEqual(["Issue"]);
    expect(document.activeElement).toBe(trigger.element);
    expect(document.body.style.overflow).toBe("");
    await trigger.trigger("click");
    await body().get(".preview-overlay").trigger("click");
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("retains an open filter across breakpoint and dismisses on context, inactive state and deactivation", async () => {
    const visible = ref(true),
      scope = ref({ ...emptyScope(), kinds: ["Issue"] });
    const Subject = defineComponent({
      setup: () => () =>
        h(PreviewCompactFilters, {
          modelValue: scope.value,
          movement: true,
          records: true,
        }),
    });
    const host = await render(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () => (visible.value ? h(Subject) : null),
          }),
      }),
    );
    await button(host, "流动类型").trigger("click");
    resize(false);
    await settle();
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    visible.value = false;
    await settle();
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    expect(scope.value.kinds).toEqual(["Issue"]);
    const panel = await render(PreviewFilterPanel, {
      label: "上下文",
      context: "one",
    });
    await button(panel, "上下文").trigger("click");
    await panel.setProps({ context: "two" });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await button(panel, "上下文").trigger("click");
    await panel.setProps({ active: false });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("consumes nested selector/tree Escape before closing its dialog and supports long option searches", async () => {
    const scope = ref(emptyScope());
    reviewSession.stock.push(
      ...Array.from({ length: 110 }, (_, i) => ({
        ...reviewSession.stock[0]!,
        code: `LONG-${i}`,
        name: `很长的物品名称${i}`,
      })),
    );
    const wrapper = await render(
      defineComponent({
        setup: () => () =>
          h(PreviewCompactFilters, {
            modelValue: scope.value,
            "onUpdate:modelValue": (value) => (scope.value = value),
          }),
      }),
    );
    await button(wrapper, "物品").trigger("click");
    const input = dialog().get('[role="combobox"]');
    await input.setValue("很长的物品名称109");
    await vi.waitFor(() =>
      expect(dialog().text()).toContain("很长的物品名称109"),
    );
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    expect(scope.value.item).toBe("LONG-109");
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await input.trigger("focus");
    await input.trigger("keydown", { key: "Escape" });
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await input.trigger("keydown", { key: "Escape" });
    await button(wrapper, "物品类别").trigger("click");
    const search = dialog().get('input[type="search"]');
    await search.setValue("不存在的类别");
    expect(dialog().text()).toContain("没有匹配的项目");
    await search.trigger("keydown", { key: "Escape" });
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await search.trigger("keydown", { key: "ArrowDown" });
    await settle();
    expect(document.activeElement?.matches('input[type="checkbox"]')).toBe(
      true,
    );
    await search.trigger("keydown", { key: "Escape" });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("keeps multi-select open, removes only one chip, and clears scopes while retaining dates", async () => {
    const scope = ref<BrowseScope>({
      ...emptyScope(),
      period: { key: "this_month", from: "", to: "" },
    });
    const wrapper = await render(
      defineComponent({
        setup: () => () =>
          h(PreviewCompactFilters, {
            modelValue: scope.value,
            "onUpdate:modelValue": (value) => (scope.value = value),
            movement: true,
            records: true,
          }),
      }),
    );
    await button(wrapper, "流动类型").trigger("click");
    await field(dialog(), "出库").get("input").setValue(true);
    await field(dialog(), "入库").get("input").setValue(true);
    expect(scope.value.kinds).toHaveLength(2);
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await button(dialog(), "完成").trigger("click");
    await wrapper
      .get('button[aria-label="移除流动类型：出库"]')
      .trigger("click");
    expect(scope.value.kinds).toEqual(["Receive"]);
    await button(wrapper, "清空筛选").trigger("click");
    expect(scope.value.kinds).toEqual([]);
    expect(scope.value.period.key).toBe("this_month");
    await button(wrapper, "仓库 / 位置").trigger("click");
    const checkbox = dialog().get('input[type="checkbox"]');
    await checkbox.setValue(true);
    expect(scope.value.warehouses.length).toBeGreaterThan(0);
    expect(body().find('[role="dialog"]').exists()).toBe(true);
  });
});
