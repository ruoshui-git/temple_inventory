import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SortableDataTable from "../src/components/SortableDataTable.vue";
import { useResponsiveLayout } from "../src/composables/useResponsiveLayout";

const media = vi.hoisted(() => ({
  matches: false,
  listener: undefined as ((event: MediaQueryListEvent) => void) | undefined,
  removed: false,
}));

beforeEach(() => {
  media.matches = false;
  media.listener = undefined;
  media.removed = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (
        _name: string,
        callback: (event: MediaQueryListEvent) => void,
      ) => {
        media.listener = callback;
      },
      removeEventListener: () => {
        media.removed = true;
      },
    }),
  });
});

describe("responsive presentation contract", () => {
  it("starts mobile-first, switches at 1024px, and cleans up the listener", async () => {
    const Probe = defineComponent({
      setup() {
        return useResponsiveLayout();
      },
      template: "<output data-surface>{{ surface }}</output>",
    });
    const wrapper = mount(Probe);
    expect(wrapper.get("output").text()).toBe("mobile");
    media.matches = true;
    media.listener?.({ matches: true } as MediaQueryListEvent);
    await nextTick();
    expect(wrapper.get("output").text()).toBe("desktop");
    wrapper.unmount();
    expect(media.removed).toBe(true);
  });

  it("lets list callers force a single renderer", () => {
    const wrapper = mount(SortableDataTable, {
      props: {
        rows: [{ id: "1", name: "一号" }],
        columns: [{ key: "name", label: "名称" }],
        rowKey: "id",
        sort: { sort_by: "name", sort_order: "asc" },
        surface: "mobile",
      },
      slots: { "mobile-row": ({ row }: any) => h("article", row.name) },
    });
    expect(wrapper.find(".sortable-data-table-desktop").exists()).toBe(false);
    expect(wrapper.find(".sortable-data-table-mobile").exists()).toBe(true);
  });

  it("keeps legacy tables responsive when no surface is supplied", async () => {
    const wrapper = mount(SortableDataTable, {
      props: {
        rows: [{ id: "1", name: "一号" }],
        columns: [{ key: "name", label: "名称" }],
        rowKey: "id",
        sort: { sort_by: "name", sort_order: "asc" },
      },
    });
    expect(wrapper.find(".sortable-data-table-mobile").exists()).toBe(true);
    media.matches = true;
    media.listener?.({ matches: true } as MediaQueryListEvent);
    await nextTick();
    expect(wrapper.find(".sortable-data-table-desktop").exists()).toBe(true);
    expect(wrapper.find(".sortable-data-table-mobile").exists()).toBe(false);
    wrapper.unmount();
  });
});
