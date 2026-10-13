import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewApp from "../src/design-preview/PreviewApp.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import {
  previewPages,
  pageHash,
  resetReviewSession,
  reviewSession,
  createDraft,
} from "../src/design-preview/reviewModel";

let wrapper: VueWrapper | undefined;
beforeEach(() => {
  resetReviewSession();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});
async function navigate(key: string) {
  window.history.replaceState(null, "", pageHash(key as never));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await nextTick();
  await nextTick();
}
function click(label: string) {
  const target = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === label);
  if (!target) throw new Error(`Missing button ${label}`);
  target.click();
}

describe("complete preview review surface", () => {
  it("renders every indexed page/state through its standalone hash", async () => {
    const errors = vi.spyOn(console, "error");
    wrapper = mount(PreviewApp, { attachTo: document.body });
    for (const route of previewPages) {
      await navigate(route.key);
      const content = wrapper.find("#sample-content");
      expect(
        content.findAll("h1").filter((heading) => heading.isVisible()).length,
        route.key,
      ).toBe(1);
      expect(content.text(), route.key).not.toContain("待补充页面");
    }
    expect(errors.mock.calls).toEqual([]);
    errors.mockRestore();
  });
  it("preserves inventory search and closes an overlay when leaving a cached page", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("inventory/list");
    await wrapper
      .find('.inventory-example input[aria-label="搜索物品或条码"]')
      .setValue("东北");
    await navigate("movement-form/Receive");
    click("复核并确认");
    await nextTick();
    expect(document.body.style.overflow).toBe("hidden");
    await navigate("dashboard/overview");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    await navigate("inventory/list");
    expect(
      (
        wrapper.find('.inventory-example input[aria-label="搜索物品或条码"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("东北");
  });
  it("restores a contextual draft into an already cached form", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("movement-form/Repair");
    await navigate("pending/actionable");
    const draft = createDraft("Repair", "PREV-CONTEXT-REPAIR");
    draft.lines = [
      {
        id: "repair-mushroom",
        code: "ITM-000132",
        qty: 3,
        uom: "袋",
        location: "斋堂 / A-01",
        batch: "MUSH-2509",
        expiry: "2026-09-30",
      },
    ];
    reviewSession.selectedDraftName = draft.name;
    await navigate("movement-form/Repair");
    expect(wrapper.find(".preview-form-page").text()).toContain("未保存");
    expect(wrapper.find(".preview-form-page").text()).toContain("3 袋");
    expect(
      (
        wrapper.find('.preview-form-page input[type="number"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("3");
  });
  it("does not overwrite an existing item through new-item confirmation", async () => {
    wrapper = mount(PreviewFormPages, {
      props: { page: "item-form", variant: "new" },
      attachTo: document.body,
    });
    await wrapper
      .find('input[placeholder="例如 ITM-000134"]')
      .setValue("ITM-000128");
    await wrapper
      .find('input[placeholder="填写清晰易识别的名称"]')
      .setValue("不应覆盖原物品");
    click("保存物品");
    await nextTick();
    expect(wrapper.find('[role="alert"]').text()).toContain("编号已存在");
    expect(reviewSession.stock[0].name).not.toBe("不应覆盖原物品");
  });
  it("accepts disposal of damaged-only stock without requiring available stock", async () => {
    const draft = createDraft("Disposal", "PREV-DISPOSAL-TEST");
    draft.lines = [
      {
        id: "1",
        code: "ITM-000132",
        qty: 3,
        uom: "袋",
        location: "斋堂 / A-01",
        batch: "MUSH-2509",
        expiry: "2026-09-30",
      },
    ];
    wrapper = mount(PreviewFormPages, {
      props: { page: "movement-form", variant: "Disposal" },
      attachTo: document.body,
    });
    click("复核并确认");
    await nextTick();
    click("确认提交");
    await nextTick();
    expect(draft.status).toBe("completed");
    expect(
      reviewSession.stock.find((row) => row.code === "ITM-000132")?.damaged,
    ).toBe(3);
  });
});
