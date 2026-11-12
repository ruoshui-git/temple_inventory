// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import UnitsView from "../src/features/units/UnitsView.vue";
import { useFormValidation } from "../src/composables/useFormValidation";
import {
  createReferenceData,
  provideReferenceData,
} from "../src/services/contracts";

const stubs = {
  BrowseToolbar: defineComponent({
    props: ["title", "summary", "search"],
    emits: ["update:search"],
    setup(_props, { slots }) {
      return () => h("header", [slots.actions?.()]);
    },
  }),
  DataTable: defineComponent({
    props: ["columns", "rows"],
    setup(props, { slots }) {
      return () =>
        h(
          "table",
          props.rows.map(
            (entry: { id: string; value: Record<string, unknown> }) =>
              h(
                "tr",
                { key: entry.id },
                props.columns.map((column: { id: string }) =>
                  h(
                    "td",
                    { key: column.id },
                    slots.cell?.({
                      column,
                      row: entry.value,
                      value: entry.value[column.id],
                    }) || String(entry.value[column.id] ?? ""),
                  ),
                ),
              ),
          ),
        );
    },
  }),
  PopupMenu: defineComponent({
    setup(_props, { slots }) {
      return () => h("div", slots.default?.());
    },
  }),
  Overlay: defineComponent({
    props: ["title"],
    setup(_props, { slots }) {
      return () => h("section", [slots.default?.(), slots.footer?.()]);
    },
  }),
};

function fixture(isMobile = true) {
  window.matchMedia = vi.fn(() => ({
    matches: !isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  const validation = useFormValidation();
  const name = ref("");
  validation.register("unit-name", () => name.value, [
    (value) => (value.trim() ? true : "请输入单位名称"),
  ]);
  const sourceRows = ref([
    {
      name: "Nos",
      label: "个",
      category: "Count",
      must_be_whole_number: true,
      enabled: true,
      item_count: 3,
      conversion_count: 1,
      deletable: false,
      delete_reason: "已被物品引用，不能删除",
    },
    {
      name: "Kg",
      label: "公斤",
      category: "Weight",
      must_be_whole_number: false,
      enabled: false,
      item_count: 0,
      conversion_count: 0,
      deletable: true,
      delete_reason: "",
    },
  ]);
  const categoryFilter = ref("");
  const wholeFilter = ref<"all" | "whole" | "fractional">("all");
  const statusFilter = ref<"all" | "enabled" | "disabled">("all");
  const search = ref("");
  const controller = {
    rows: sourceRows,
    visible: computed(() =>
      sourceRows.value.filter(
        (row) =>
          (!search.value ||
            `${row.name} ${row.label} ${row.category}`
              .toLocaleLowerCase()
              .includes(search.value.toLocaleLowerCase())) &&
          (!categoryFilter.value ||
            (categoryFilter.value === "__uncategorized"
              ? !row.category
              : row.category === categoryFilter.value)) &&
          (wholeFilter.value === "all" ||
            row.must_be_whole_number === (wholeFilter.value === "whole")) &&
          (statusFilter.value === "all" ||
            row.enabled === (statusFilter.value === "enabled")),
      ),
    ),
    search,
    categoryFilter,
    wholeFilter,
    statusFilter,
    loading: ref(false),
    initialized: ref(true),
    dialog: ref(false),
    editing: ref(undefined),
    error: ref(""),
    labelError: ref(""),
    refreshError: ref(""),
    name,
    label: ref(""),
    whole: ref(false),
    enabled: ref(true),
    category: ref(""),
    categoryName: ref(""),
    categories: ref([{ name: "Count" }]),
    saving: ref(false),
    validation,
    refresh: vi.fn(),
    openCreate: vi.fn(() => {
      name.value = "";
      controller.dialog.value = true;
    }),
    openEdit: vi.fn(),
    save: vi.fn(() => {
      if (!controller.editing.value && !validation.validate().ok) return;
    }),
    addCategory: vi.fn(),
    toggleEnabled: vi.fn(),
    remove: vi.fn(),
  };
  const reference = createReferenceData();
  reference.capabilities.uom.create = true;
  reference.capabilities.uom.write = true;
  reference.capabilities.uom.delete = true;
  const wrapper = mount(
    defineComponent({
      setup() {
        provideReferenceData(reference);
        return () => h(UnitsView, { controller: controller as never });
      },
    }),
    { global: { stubs } },
  );
  return { wrapper, controller };
}

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as Partial<Window>).matchMedia;
});

describe("units management page", () => {
  it("renders unit rows and the blocked-delete reason in its action menu", () => {
    const { wrapper } = fixture();
    expect(wrapper.text()).toContain("个");
    expect(wrapper.text()).toContain("Nos");
    expect(wrapper.text()).toContain("已被物品引用，不能删除");
    expect(wrapper.text()).toContain("库存单位物品 3 项，物品单位换算 1 项");
    expect(
      wrapper
        .findAll("button[disabled]")
        .some((button) => button.text().includes("删除")),
    ).toBe(true);
    expect(wrapper.text()).toContain("单位类别 Count");
    expect(
      wrapper
        .findAll("button")
        .find((button) => button.text().includes("停用"))
        ?.attributes("disabled"),
    ).toBeDefined();
  });

  it("validates the create dialog before saving", async () => {
    const { wrapper, controller } = fixture();
    controller.dialog.value = true;
    await wrapper.vm.$nextTick();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("请输入单位名称");
    expect(controller.save).toHaveBeenCalledOnce();
  });

  it("filters phone rows and collapses category groups", async () => {
    const { wrapper, controller } = fixture();
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(1);
    expect(wrapper.findAll(".units-phone-group")).toHaveLength(2);
    controller.categoryFilter.value = "Count";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(1);
    expect(wrapper.find(".units-phone-card").text()).toContain("个");
    await wrapper.get(".units-phone-group").trigger("click");
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(0);
    controller.categoryFilter.value = "";
    controller.wholeFilter.value = "fractional";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(1);
    expect(wrapper.find(".units-phone-card").text()).toContain("公斤");
    controller.search.value = "公斤";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(1);
    expect(wrapper.find(".units-phone-card").text()).toContain("公斤");
    controller.search.value = "";
    controller.wholeFilter.value = "all";
    controller.statusFilter.value = "enabled";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(0);
    await wrapper.get(".units-phone-group").trigger("click");
    expect(wrapper.findAll(".units-phone-card")).toHaveLength(1);
    expect(wrapper.find(".units-phone-card").text()).toContain("个");
  });

  it("shows used units first and expands the unused remainder on phone and desktop", async () => {
    for (const isMobile of [true, false]) {
      const { wrapper, controller } = fixture(isMobile);
      controller.rows.value.push({
        name: "Case",
        label: "箱",
        category: "Count",
        must_be_whole_number: true,
        enabled: true,
        item_count: 0,
        conversion_count: 0,
        deletable: true,
        delete_reason: "",
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll(".units-phone-card")).toHaveLength(
        isMobile ? 1 : 0,
      );
      expect(wrapper.find(".units-rest-toggle").text()).toBe(
        "显示其余 1 个单位",
      );
      await wrapper.get(".units-rest-toggle").trigger("click");
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll(".units-phone-card")).toHaveLength(
        isMobile ? 2 : 0,
      );
      expect(wrapper.find(".units-rest-toggle").text()).toBe(
        "收起其余 1 个单位",
      );

      controller.search.value = "Case";
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain("箱");
      expect(wrapper.findAll(".units-rest-toggle")).toHaveLength(0);
      if (isMobile)
        expect(wrapper.findAll(".units-phone-card")).toHaveLength(1);
      wrapper.unmount();
    }
  });

  it("applies unit filters to the grouped desktop table too", async () => {
    const { wrapper, controller } = fixture(false);
    await flushPromises();
    expect(wrapper.findAll("tr")).toHaveLength(3);
    controller.categoryFilter.value = "Weight";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("公斤");
    expect(wrapper.text()).not.toContain("Nos");
  });
});
