// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import UnitsView from "../src/features/units/UnitsView.vue";
import { useFormValidation } from "../src/composables/useFormValidation";

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

function fixture() {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  const validation = useFormValidation();
  const name = ref("");
  validation.register("unit-name", () => name.value, [
    (value) => (value.trim() ? true : "请输入单位名称"),
  ]);
  const controller = {
    visible: ref([
      {
        name: "Nos",
        label: "个",
        must_be_whole_number: true,
        enabled: true,
        item_count: 3,
        conversion_count: 1,
        deletable: false,
        delete_reason: "已被物品引用，不能删除；可以停用",
      },
    ]),
    search: ref(""),
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
    toggleEnabled: vi.fn(),
    remove: vi.fn(),
  };
  const wrapper = mount(UnitsView, {
    props: { controller: controller as never },
    global: { stubs },
  });
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
    expect(wrapper.text()).toContain("已被物品引用，不能删除；可以停用");
    expect(wrapper.get("button[disabled]").text()).toContain("删除");
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
});
