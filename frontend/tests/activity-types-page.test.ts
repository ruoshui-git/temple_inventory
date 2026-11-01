// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ActivityTypesView from "../src/features/activityTypes/ActivityTypesView.vue";
import type { ActivityTypeRow } from "../src/services/activityTypes";

const stubs = {
  BrowseToolbar: defineComponent({
    props: ["title", "summary", "search"],
    emits: ["update:search"],
    setup(_props, { slots }) {
      return () => h("header", [slots.actions?.(), slots.filters?.()]);
    },
  }),
  BrowseChip: defineComponent({ template: "<span><slot /></span>" }),
  BrowseSplitButton: defineComponent({
    props: ["label"],
    emits: ["select"],
    template: "<button @click=\"$emit('select')\">{{ label }}</button>",
  }),
  DataTable: defineComponent({
    props: ["columns", "rows"],
    setup(props, { slots }) {
      return () =>
        h("table", [
          h(
            "thead",
            h(
              "tr",
              props.columns.map((column: { id: string; label: string }) =>
                h("th", { key: column.id }, column.label),
              ),
            ),
          ),
          h(
            "tbody",
            props.rows.map(
              (entry: { id: string; value: Record<string, unknown> }) =>
                h(
                  "tr",
                  { key: entry.id },
                  props.columns.map((column: { id: string }) =>
                    h(
                      "td",
                      { key: column.id },
                      slots.cell?.({ column, row: entry.value }) ||
                        String(entry.value[column.id] ?? ""),
                    ),
                  ),
                ),
            ),
          ),
        ]);
    },
  }),
  PopupMenu: defineComponent({
    setup(_props, { slots }) {
      return () => h("div", slots.default?.());
    },
  }),
  Overlay: defineComponent({
    props: ["title"],
    template:
      '<section role="dialog"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>',
  }),
};
function fixture(mobile = true) {
  window.matchMedia = vi.fn(() => ({
    matches: !mobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  const rows = ref<ActivityTypeRow[]>([
    {
      name: "TYPE-A",
      label: "供灯",
      enabled: true,
      display_order: 1,
      activity_count: 2,
      deletable: false,
      delete_reason: "已有 2 个活动使用此类型，可停用",
    },
    {
      name: "TYPE-B",
      label: "维护",
      enabled: false,
      display_order: 2,
      activity_count: 0,
      deletable: true,
      delete_reason: "",
    },
  ]);
  const search = ref("");
  const statusFilter = ref<"all" | "enabled" | "disabled">("all");
  const dialog = ref(false);
  const editing = ref<ActivityTypeRow>();
  const visible = computed(() =>
    rows.value.filter(
      (row) =>
        (!search.value || `${row.name} ${row.label}`.includes(search.value)) &&
        (statusFilter.value === "all" ||
          row.enabled === (statusFilter.value === "enabled")),
    ),
  );
  const controller = {
    rows,
    visible,
    search,
    statusFilter,
    dialog,
    editing,
    label: ref(""),
    enabled: ref(true),
    loading: ref(false),
    saving: ref(false),
    initialized: ref(true),
    refreshError: ref(""),
    error: ref(""),
    refresh: vi.fn(),
    openCreate: vi.fn(() => {
      editing.value = undefined;
      dialog.value = true;
    }),
    openEdit: vi.fn((row: ActivityTypeRow) => {
      editing.value = row;
      dialog.value = true;
    }),
    save: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
  };
  const wrapper = mount(ActivityTypesView, {
    props: { controller: controller as never },
    global: { stubs },
  });
  return { wrapper, controller };
}
afterEach(() => {
  document.body.innerHTML = "";
  delete (window as Partial<Window>).matchMedia;
});
describe("activity type management page", () => {
  it("renders rows and filters them by enabled status", async () => {
    const { wrapper, controller } = fixture();
    expect(wrapper.findAll(".activity-types-phone-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("已有 2 个活动使用此类型，可停用");
    controller.statusFilter.value = "enabled";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".activity-types-phone-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("供灯");
    expect(wrapper.text()).not.toContain("维护");
  });
  it("renders desktop rows, status, usage and order controls", async () => {
    const { wrapper, controller } = fixture(false);
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("活动数");
    expect(
      wrapper.get('button[aria-label="上移"]').attributes("disabled"),
    ).toBeDefined();
    controller.search.value = "供灯";
    await wrapper.vm.$nextTick();
    expect(
      wrapper.get('button[aria-label="下移"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("opens create and edit dialogs and provides the disable help text", async () => {
    const { wrapper, controller } = fixture();
    controller.openCreate();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[role="dialog"]').text()).toContain(
      "停用后，此类型的活动不能再被新记录选择。",
    );
    controller.dialog.value = false;
    controller.openEdit(controller.rows.value[1]!);
    await wrapper.vm.$nextTick();
    expect(controller.openEdit).toHaveBeenCalledWith(controller.rows.value[1]);
    expect(wrapper.get('[role="dialog"]').text()).toContain("编辑活动类型");
  });
});
