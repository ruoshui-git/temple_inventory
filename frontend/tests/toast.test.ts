// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import ToastHost from "../src/components/ui/ToastHost.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { showToast } from "../src/services/toast";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function setup() {
  const reference = createReferenceData();
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), upload: vi.fn(), report: vi.fn() },
          reference,
        );
        return () => h(ToastHost);
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  return { reference, wrapper };
}

it("keeps actionable warning feedback in the global toast stack and runs its action", async () => {
  const { wrapper } = setup();
  const dialog = document.createElement("section");
  dialog.className = "preview-dialog";
  document.body.append(dialog);
  await flushPromises();
  const action = vi.fn();
  showToast("草稿仅保存在此浏览器", "warning", {
    label: "查看恢复内容",
    action,
  });
  await flushPromises();
  const toast = document.querySelector<HTMLElement>(
    '[role="alert"].preview-toast',
  );
  expect(toast).not.toBeNull();
  expect(dialog.contains(toast)).toBe(false);
  expect(toast?.textContent).toContain("草稿仅保存在此浏览器");
  toast?.querySelectorAll("button")[0]?.click();
  await flushPromises();
  expect(action).toHaveBeenCalledOnce();
  expect(document.querySelector(".preview-toast")).toBeNull();
});

it("deduplicates repeated events and clears queued notices on account changes", async () => {
  vi.useFakeTimers();
  const { reference, wrapper } = setup();
  showToast("已保存", "success", undefined, "save-1");
  showToast("已保存", "success", undefined, "save-1");
  await flushPromises();
  expect(document.querySelectorAll(".preview-toast")).toHaveLength(1);
  reference.user = "another-account";
  await flushPromises();
  expect(document.querySelector(".preview-toast")).toBeNull();
});

it("keeps update notices visible until dismissal and runs the reload action", async () => {
  vi.useFakeTimers();
  setup();
  const reload = vi.fn();
  showToast(
    "发现新版本，可以更新。",
    "warning",
    { label: "更新", action: reload },
    "pwa-update:test",
    true,
  );
  await flushPromises();
  await vi.advanceTimersByTimeAsync(5100);
  expect(document.querySelector(".preview-toast")?.textContent).toContain(
    "发现新版本",
  );
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    ".preview-toast button",
  );
  buttons[0]?.click();
  await flushPromises();
  expect(reload).toHaveBeenCalledOnce();
  expect(document.querySelector(".preview-toast")).toBeNull();
});
