import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { flushPromises } from "@vue/test-utils";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { useResponsiveLayout } from "../src/composables/useResponsiveLayout";

const media = vi.hoisted(() => ({
  matches: false,
  listener: undefined as ((event: MediaQueryListEvent) => void) | undefined,
  removed: false,
  listeners: new Set<(event: MediaQueryListEvent) => void>(),
}));

beforeEach(() => {
  media.matches = false;
  media.listeners.clear();
  media.listener = (event) => {
    for (const callback of [...media.listeners]) callback(event);
  };
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
        media.listeners.add(callback);
      },
      removeEventListener: (
        _name: string,
        callback: (event: MediaQueryListEvent) => void,
      ) => {
        media.listeners.delete(callback);
        media.removed = true;
      },
    }),
  });
});

describe("responsive presentation contract", () => {
  it("keeps compact sticky search, mobile Stock tabs, and fixed actions within obstruction geometry", () => {
    const browse = readFileSync("src/styles/browse.css", "utf8");
    const shell = readFileSync("src/styles/foundation.css", "utf8");
    const forms = readFileSync("src/styles/forms.css", "utf8");
    expect(browse).toContain(".browse-chrome.is-stuck .browse-inline-tools");
    expect(browse).toContain(".browse-persistent-chips::-webkit-scrollbar");
    expect(browse).toContain("--browse-fab-reserve");
    expect(browse).toContain("--browse-fab-height");
    expect(shell).toContain(".mobile-context a[aria-current]");
    expect(shell).toContain("--preview-nav-height, 84px) + 76px");
    expect(forms).toContain("--preview-action-bar-height");
    expect(forms).toContain(
      "var(--preview-action-bar-height) + var(--preview-nav-height",
    );
  });

  it("keeps editor title controls in the title row and places ERPNext links in phone overflow menus", () => {
    const operation = readFileSync(
      "src/features/documents/OperationEditorView.vue",
      "utf8",
    );
    const count = readFileSync(
      "src/features/counts/CountEditorView.vue",
      "utf8",
    );
    expect(operation).toContain('class="operation-page-title-row"');
    expect(count).toContain('class="operation-page-title-row"');
    expect(operation).toContain('class="phone-erpnext-link"');
    expect(count).toContain('class="phone-erpnext-link"');
    expect(operation).toContain('class="editor-overflow-menu"');
    expect(count).toContain('class="count-editor-overflow-menu"');
  });

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

  it("retains the native controller, rows, filter and selection through breakpoint changes", async () => {
    const call = vi.fn(async () => ({
      rows: [
        {
          code: "ITEM-1",
          name: "中文物品",
          category: "物资",
          uom: "Nos",
          available: 3,
          loaned: 0,
          damaged: 0,
          locations: [],
          tracksBatch: false,
          tracksExpiry: false,
        },
      ],
      matched_count: 1,
      next_start: null,
      summary: [],
      analysis: { category: [], location: [] },
    }));
    const wrapper = mount(
      defineComponent({
        setup() {
          const reference = createReferenceData();
          reference.user = "manager";
          reference.site = "test";
          provideInventoryServices(
            { call, report: vi.fn(), upload: vi.fn() },
            reference,
          );
          return () => h(StockBrowsePage);
        },
      }),
    );
    await flushPromises();
    const controller = wrapper.getComponent(StockBrowsePage).vm.controller;
    controller.selected.value = ["ITEM-1"];
    controller.view.value = "table";
    const rows = controller.data.rows;
    const requests = call.mock.calls.length;
    media.matches = true;
    media.listener?.({ matches: true } as MediaQueryListEvent);
    await nextTick();
    media.matches = false;
    media.listener?.({ matches: false } as MediaQueryListEvent);
    await nextTick();
    expect(wrapper.getComponent(StockBrowsePage).vm.controller).toBe(
      controller,
    );
    expect(controller.data.rows).toBe(rows);
    expect(controller.selected.value).toEqual(["ITEM-1"]);
    expect(controller.view.value).toBe("table");
    expect(call.mock.calls.length).toBe(requests);
    wrapper.unmount();
    expect(media.removed).toBe(true);
  });
});
