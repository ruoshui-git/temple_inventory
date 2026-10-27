// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import ScanPanel from "../src/features/scanner/ScanPanel.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const ButtonStub = defineComponent({
  name: "UiButton",
  props: {
    loading: Boolean,
    loadingLabel: { type: String, default: "正在处理…" },
  },
  emits: ["click"],
  template:
    '<button :disabled="loading" :aria-busy="loading" @click="$emit(\'click\')">{{ loading ? loadingLabel : \'\' }}<slot v-if="!loading" /></button>',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("inline operation scan panel", () => {
  it("holds later scans while an unknown item is created, then resumes the queued barcode", async () => {
    const first = deferred<unknown>();
    const call = vi.fn<InventoryServices["call"]>((endpoint, args) => {
      if (endpoint !== "catalog.scan_code")
        throw new Error(`Unexpected ${endpoint}`);
      if (args?.value === "UNKNOWN") return first.promise as never;
      return Promise.resolve({
        unknown: false,
        barcode: "NEXT",
        matches: [{ item_code: "ITEM-NEXT", has_batch_no: false }],
        batches: [],
      }) as never;
    });
    const accepted = vi.fn(async () => {});
    const reference = createReferenceData();
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(ScanPanel, {
            inline: true,
            autoUnique: true,
            allowCreate: true,
            acceptItem: accepted,
          });
      },
    });
    const wrapper = mount(host, {
      global: {
        stubs: { UiButton: ButtonStub, SearchSelect: true, Scanner: true },
      },
    });
    wrappers.push(wrapper);
    const panel = wrapper.findComponent(ScanPanel);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "扫描物品 / 批次 / 库位")!
      .trigger("click");
    await nextTick();

    const input = wrapper.get(
      'input:not([type="checkbox"]):not([type="file"])',
    );
    await input.setValue("UNKNOWN");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "查找")!
      .trigger("click");
    const searching = wrapper
      .findAll("button")
      .find((button) => button.text() === "正在查找…")!;
    expect(searching.attributes("aria-busy")).toBe("true");
    await input.setValue("NEXT");
    await input.trigger("keydown.enter");
    expect(call).toHaveBeenCalledTimes(1);
    first.resolve({
      unknown: true,
      barcode: "UNKNOWN",
      matches: [],
      batches: [],
    });
    await flushPromises();
    expect(panel.text()).toContain("UNKNOWN");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "新建物品")!
      .trigger("click");
    await flushPromises();
    expect(call).toHaveBeenCalledTimes(1);
    expect(panel.emitted("create")).toEqual([["UNKNOWN", undefined]]);

    (
      panel.vm.$.exposed as { resumeAfterCreate: () => void }
    ).resumeAfterCreate();
    await flushPromises();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]?.[1]).toEqual({ value: "NEXT" });
    expect(accepted).toHaveBeenCalledWith("ITEM-NEXT", undefined, undefined);
  });
});
