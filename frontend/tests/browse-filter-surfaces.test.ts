// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, provide, reactive, ref } from "vue";
import PeriodFilter from "../src/components/ui/PeriodFilter.vue";
import FilterPanel from "../src/components/ui/FilterPanel.vue";
import BrowseToolbar from "../src/components/ui/BrowseToolbar.vue";
import BrowseFilters from "../src/components/filters/BrowseFilters.vue";
import { useFilterRailPreference } from "../src/composables/useFilterRailPreference";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import GroupByFilter from "../src/components/filters/GroupByFilter.vue";
import FilterDisclosure from "../src/components/ui/FilterDisclosure.vue";
import { filterPanelSessionKey } from "../src/lib/filterPanelSession";
import { emptyScope } from "../src/lib/browseQuery";
import {
  clearScopeField,
  scopeFilterFieldChips,
} from "../src/lib/filterPresentation";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("keeps sidebar hierarchy sections visible and opens the requested collapsed filter editor", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const staticSection = mount(FilterDisclosure, {
    props: {
      label: "物品类别",
      field: "categories",
      disclosure: false,
      summary: "无分类",
    },
    slots: { default: "类别树" },
  });
  expect(staticSection.find("details").exists()).toBe(false);
  expect(staticSection.get("section").text()).toContain("物品类别");
  staticSection.unmount();

  const wrapper = mount(FilterPanel, {
    props: { label: "筛选", active: true },
    slots: {
      default: () =>
        h("details", { "data-filter-field": "status" }, [
          h("summary", "状态"),
          h("input", { "aria-label": "状态编辑器" }),
        ]),
    },
    attachTo: document.body,
  });
  await wrapper.vm.show("status");
  await flushPromises();
  expect(
    document
      .querySelector("details[data-filter-field=status]")
      ?.hasAttribute("open"),
  ).toBe(true);
  const editor = document.querySelector<HTMLInputElement>(
    'input[aria-label="状态编辑器"]',
  )!;
  expect(document.activeElement).toBe(editor);
  document.querySelector<HTMLDetailsElement>(
    "details[data-filter-field=status]",
  )!.open = true;
  await wrapper.vm.hide();
  await wrapper.vm.show();
  await flushPromises();
  expect(
    document
      .querySelector("details[data-filter-field=status]")
      ?.hasAttribute("open"),
  ).toBe(false);
  wrapper.unmount();
});

it("stages embedded period presets and commits calendar quarters as custom bounds", async () => {
  const wrapper = mount(PeriodFilter, {
    props: {
      modelValue: { key: "all", from: "", to: "" },
      label: "记账日期",
      today: "2026-10-20",
      embedded: true,
    },
  });
  const selects = wrapper.findAll("select");
  await wrapper.get('input[aria-label="记账日期快捷年份"]').setValue("2025");
  await selects[1]!.setValue("2");
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  await wrapper.get("form").trigger("submit");
  expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({
    key: "custom",
    from: "2025-04-01",
    to: "2025-06-30",
  });
  expect(wrapper.find(".preview-period-trigger").exists()).toBe(false);
  wrapper.unmount();
});

it("supports arbitrary future quarters, editable inclusive bounds, and inline validation", async () => {
  const wrapper = mount(PeriodFilter, {
    props: {
      modelValue: { key: "all", from: "", to: "" },
      label: "日期",
      today: "2026-10-20",
      embedded: true,
    },
  });
  await wrapper.get('input[aria-label="日期快捷年份"]').setValue("2052");
  await wrapper.get('select[aria-label="日期快捷年份范围"]').setValue("3");
  await wrapper.get("button").trigger("click");
  expect(wrapper.get('input[aria-label="日期开始日期"]').element.value).toBe(
    "2052-07-01",
  );
  expect(wrapper.get('input[aria-label="日期结束日期"]').element.value).toBe(
    "2052-09-30",
  );
  await wrapper.get('input[aria-label="日期结束日期"]').setValue("2052-06-30");
  await wrapper.get("form").trigger("submit");
  expect(wrapper.get('[role="alert"]').text()).toContain("不能早于开始日期");
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  await wrapper.get('input[aria-label="日期结束日期"]').setValue("2052-09-30");
  await wrapper.get("form").trigger("submit");
  expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({
    key: "custom",
    from: "2052-07-01",
    to: "2052-09-30",
  });
  wrapper.unmount();
});

it("discards an unapplied date draft when the shared filter panel dismisses", async () => {
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(filterPanelSessionKey, "panel-a");
        return () =>
          h(PeriodFilter, {
            modelValue: { key: "all", from: "", to: "" },
            label: "日期",
            today: "2026-10-20",
            embedded: true,
          });
      },
    }),
  );
  const editor = wrapper.getComponent(PeriodFilter);
  await editor.find("select").setValue("last_30_days");
  document.dispatchEvent(
    new CustomEvent("preview-filter-panel-close", { detail: "another-panel" }),
  );
  expect(editor.find("select").element.value).toBe("last_30_days");
  document.dispatchEvent(
    new CustomEvent("preview-filter-panel-close", { detail: "panel-a" }),
  );
  await editor.get("form").trigger("submit");
  expect(editor.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({
    key: "all",
    from: "",
    to: "",
  });
  wrapper.unmount();
});

it("discards a mobile date draft on real Escape and restores focus to the filter trigger", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const applied = ref({ key: "all" as const, from: "", to: "" });
  const session = "mobile-filter-session";
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(filterPanelSessionKey, session);
        return () =>
          h(
            FilterPanel,
            {
              label: "筛选",
              context: "库存",
              onUpdateOpen: (open: boolean) => {
                if (!open)
                  document.dispatchEvent(
                    new CustomEvent("preview-filter-panel-close", {
                      detail: session,
                    }),
                  );
              },
            },
            {
              default: () =>
                h(PeriodFilter, {
                  modelValue: applied.value,
                  label: "记账日期",
                  today: "2026-10-20",
                  embedded: true,
                  "onUpdate:modelValue": (value) => (applied.value = value),
                }),
            },
          );
      },
    }),
    { attachTo: document.body },
  );
  const trigger = wrapper.get('button[aria-haspopup="dialog"]');
  trigger.element.focus();
  await trigger.trigger("click");
  await flushPromises();
  await wrapper
    .getComponent(PeriodFilter)
    .get("select")
    .setValue("last_30_days");
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await flushPromises();
  expect(applied.value).toEqual({ key: "all", from: "", to: "" });
  expect(document.activeElement).toBe(trigger.element);
  await trigger.trigger("click");
  await flushPromises();
  expect(wrapper.getComponent(PeriodFilter).get("select").element.value).toBe(
    "all",
  );
  wrapper.unmount();
});

it("offers labeled rail-edit actions instead of duplicating hierarchy trees in the panel", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  const reference = reactive(createReferenceData());
  const services = {
    call: vi.fn(async () => []),
    report: vi.fn(),
    upload: vi.fn(),
  } as unknown as import("../src/services/contracts").InventoryServices;
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(services, reference);
        return () =>
          h("div", [
            h(
              BrowseToolbar,
              {
                title: "库存",
                summary: "库存",
                sidebarAvailable: true,
                sidebarOpen: true,
              },
              {
                filters: () =>
                  h(BrowseFilters, {
                    modelValue: emptyScope(),
                    hierarchyInRail: true,
                    disclosureMode: true,
                    fields: ["categories", "warehouses"],
                  }),
              },
            ),
            h("aside", { class: "browse-filter-rail" }, [
              h("fieldset", { "data-filter-field": "categories" }, [
                h("input", { "aria-label": "类别树搜索" }),
              ]),
              h("fieldset", { "data-filter-field": "warehouses" }, [
                h("input", { "aria-label": "仓库树搜索" }),
              ]),
            ]),
          ]);
      },
    }),
    { attachTo: document.body },
  );
  await flushPromises();
  const categoryTree = wrapper.element.querySelector<HTMLElement>(
    '.browse-filter-rail [data-filter-field="categories"]',
  )!;
  categoryTree.scrollIntoView = vi.fn();
  await wrapper.get('button[aria-haspopup="dialog"]').trigger("click");
  await flushPromises();
  expect(document.body.textContent).toContain("在侧栏中编辑类别筛选");
  expect(document.body.textContent).toContain("在侧栏中编辑仓库筛选");
  expect(document.querySelectorAll(".hierarchy-list")).toHaveLength(0);
  const categoryAction = document.querySelector<HTMLElement>(
    '.preview-filter-popover [data-filter-field="categories"] button',
  )!;
  await categoryAction.click();
  await flushPromises();
  expect(document.querySelector(".preview-filter-popover")).toBeNull();
  expect(document.activeElement).toBe(
    wrapper.element.querySelector('[aria-label="类别树搜索"]'),
  );
  wrapper.unmount();
});

it("opens with the applied custom range and keeps independent date fields addressable", async () => {
  const wrapper = mount(PeriodFilter, {
    props: {
      modelValue: { key: "custom", from: "2025-04-01", to: "2025-06-30" },
      label: "关联日期",
      fieldKey: "relatedPeriod",
      today: "2026-10-20",
      embedded: true,
    },
  });
  expect(wrapper.attributes("data-filter-field")).toBe("relatedPeriod");
  expect(
    wrapper.get('input[aria-label="关联日期开始日期"]').element.value,
  ).toBe("2025-04-01");
  expect(wrapper.text()).toContain("2025-Q2");
  await wrapper
    .get('input[aria-label="关联日期结束日期"]')
    .setValue("2025-06-29");
  expect(wrapper.text()).not.toContain("已选快捷范围：2025-Q2");
  wrapper.unmount();
});

it("keeps rail visibility as a site and account scoped presentation preference", async () => {
  const reference = reactive(createReferenceData());
  reference.site = "temple-a";
  reference.user = "manager@example.org";
  const wrapper = mount(
    defineComponent({
      setup() {
        const { open, toggle } = useFilterRailPreference(
          "movement.items",
          reference,
          false,
        );
        return () =>
          h(
            "button",
            { onClick: toggle, "aria-pressed": open.value },
            String(open.value),
          );
      },
    }),
  );
  await flushPromises();
  expect(wrapper.get("button").attributes("aria-pressed")).toBe("false");
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get("button").attributes("aria-pressed")).toBe("true");
  reference.user = "other@example.org";
  await flushPromises();
  expect(wrapper.get("button").attributes("aria-pressed")).toBe("false");
  reference.user = "manager@example.org";
  await flushPromises();
  expect(wrapper.get("button").attributes("aria-pressed")).toBe("true");
  wrapper.unmount();
});

it("stores rail visibility in the user's Frappe defaults and retries a failed save", async () => {
  const reference = reactive(createReferenceData());
  reference.site = "temple-a";
  reference.user = "manager@example.org";
  let failSave = true;
  const call = vi.fn(async (endpoint: string) => {
    if (endpoint.endsWith("get_presentation_preference")) return undefined;
    if (failSave) {
      failSave = false;
      throw new Error("offline");
    }
    return true;
  });
  const services = {
    call,
    report: vi.fn(),
    upload: vi.fn(),
  } as unknown as import("../src/services/contracts").InventoryServices;
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(services, reference);
        const { open, toggle, saveError, retry } = useFilterRailPreference(
          "movement.items",
          reference,
          false,
          services,
        );
        return () =>
          h("div", [
            h("button", { onClick: toggle, "aria-pressed": open.value }),
            h("button", { onClick: retry, "data-retry": true }),
            h("p", { role: "alert" }, saveError.value),
          ]);
      },
    }),
  );
  await flushPromises();
  await wrapper.get("button[aria-pressed]").trigger("click");
  await vi.waitFor(() =>
    expect(wrapper.get('[role="alert"]').text()).toContain("未保存"),
  );

  await flushPromises();
  expect(call).toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toContain("未保存");
  await wrapper.get("[data-retry]").trigger("click");
  await flushPromises();
  expect(call.mock.calls.map(([endpoint]) => endpoint)).toContain(
    "table_preferences.save_presentation_preference",
  );
  expect(wrapper.get('[role="alert"]').text()).toBe("");
  wrapper.unmount();
});

it("hydrates server presentation without writing and cancels saves on account change or unmount", async () => {
  vi.useFakeTimers();
  const reference = reactive(createReferenceData());
  reference.site = "temple-a";
  reference.user = "manager@example.org";
  const call = vi.fn(async (endpoint: string) =>
    endpoint.endsWith("get_presentation_preference") ? true : true,
  );
  const services = {
    call,
    report: vi.fn(),
    upload: vi.fn(),
  } as unknown as import("../src/services/contracts").InventoryServices;
  const wrapper = mount(
    defineComponent({
      setup() {
        const { open, toggle } = useFilterRailPreference(
          "stock",
          reference,
          false,
          services,
        );
        return () => h("button", { onClick: toggle }, String(open.value));
      },
    }),
  );
  await flushPromises();
  expect(wrapper.get("button").text()).toBe("true");
  expect(call.mock.calls.map(([endpoint]) => endpoint)).toEqual([
    "table_preferences.get_presentation_preference",
  ]);
  await wrapper.get("button").trigger("click");
  reference.user = "other@example.org";
  await flushPromises();
  await vi.advanceTimersByTimeAsync(500);
  expect(
    call.mock.calls.some(([endpoint]) =>
      endpoint.endsWith("save_presentation_preference"),
    ),
  ).toBe(false);
  wrapper.unmount();

  const second = mount(
    defineComponent({
      setup() {
        const { toggle } = useFilterRailPreference(
          "expiry",
          reference,
          false,
          services,
        );
        return () => h("button", { onClick: toggle }, "toggle");
      },
    }),
  );
  await flushPromises();
  await second.get("button").trigger("click");
  second.unmount();
  await vi.advanceTimersByTimeAsync(500);
  expect(
    call.mock.calls.some(([endpoint]) =>
      endpoint.endsWith("save_presentation_preference"),
    ),
  ).toBe(false);
  vi.useRealTimers();
});

it("keeps selected scope values editable while toolbar chips summarize fields", () => {
  const reference = createReferenceData();
  reference.items = [{ value: "ITEM-1", label: "活动周转箱" }];
  reference.categories = [
    { name: "Food", label: "食品" },
    { name: "Tools", label: "工具" },
    { name: "Cloth", label: "布料" },
  ];
  reference.warehouses = [
    { name: "A02", label: "位置 A02" },
    { name: "A04", label: "位置 A04" },
    { name: "A07", label: "位置 A07" },
  ];
  const chips = scopeFilterFieldChips(
    {
      period: { key: "all", from: "", to: "" },
      item: "ITEM-1",
      activity: "",
      categories: ["Food", "Tools", "Cloth"],
      warehouses: ["A02", "A04", "A07"],
      kinds: [],
      sources: [],
      destinations: [],
      uncategorized: true,
    },
    reference,
  );
  expect(chips).toEqual([
    { key: "field:item", field: "item", label: "物品：活动周转箱" },
    {
      key: "field:categories",
      field: "categories",
      label: "物品类别：食品、工具 + 2 项",
    },
    {
      key: "field:warehouses",
      field: "warehouses",
      label: "仓库 / 位置：位置 A02、位置 A04 + 1 项",
    },
  ]);

  const onlyUncategorized = scopeFilterFieldChips(
    {
      period: { key: "all", from: "", to: "" },
      item: "",
      activity: "",
      categories: [],
      warehouses: [],
      kinds: [],
      sources: [],
      destinations: [],
      uncategorized: true,
    },
    reference,
  );
  expect(onlyUncategorized[0]?.label).toBe("物品类别：无分类");

  const unresolvedLocation = scopeFilterFieldChips(
    {
      period: { key: "all", from: "", to: "" },
      item: "",
      activity: "",
      categories: [],
      warehouses: ["AUTHORIZED-LOCATION-ID"],
      kinds: [],
      sources: [],
      destinations: [],
      uncategorized: false,
    },
    reference,
  );
  expect(unresolvedLocation[0]?.label).toContain("AUTHORIZED-LOCATION-ID");
});

it("shows active date scopes as removable field chips", () => {
  const scope = {
    period: { key: "last_quarter" as const, from: "", to: "" },
    item: "",
    activity: "",
    categories: [],
    warehouses: [],
    kinds: [],
    sources: [],
    destinations: [],
    uncategorized: false,
  };
  expect(scopeFilterFieldChips(scope)).toEqual([
    { key: "field:period", field: "period", label: "日期：上季度" },
  ]);
  clearScopeField(scope, "period");
  expect(scope.period).toEqual({ key: "all", from: "", to: "" });
});

it("limits browse grouping to two ordered fields and preserves category-to-item grouping", async () => {
  const wrapper = mount(GroupByFilter, {
    props: { dataset: "inventory", view: "locations", modelValue: [] },
  });
  await wrapper.findAll("select")[0]!.setValue("category");
  await wrapper.setProps({ modelValue: ["category"] });
  await wrapper.findAll("select")[1]!.setValue("item");
  expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual([
    "category",
    "item",
  ]);
  wrapper.unmount();
});
