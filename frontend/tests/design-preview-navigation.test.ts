import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewApp from "../src/design-preview/PreviewApp.vue";
import PreviewBrowsePages from "../src/design-preview/PreviewBrowsePages.vue";
import PreviewHierarchyFilter from "../src/design-preview/components/PreviewHierarchyFilter.vue";
import {
  pageHash,
  resetReviewSession,
  reviewSession,
  reviewMovementRows,
  createDraft,
  submitDraft,
  type PreviewPageKey,
} from "../src/design-preview/reviewModel";

let wrapper: VueWrapper;
let desktop = true;
const listeners = new Set<(event: { matches: boolean }) => void>();
beforeEach(() => {
  resetReviewSession();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  desktop = true;
  listeners.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return desktop;
      },
      addEventListener: (
        _: string,
        callback: (event: { matches: boolean }) => void,
      ) => listeners.add(callback),
      removeEventListener: (
        _: string,
        callback: (event: { matches: boolean }) => void,
      ) => listeners.delete(callback),
    })),
  );
});
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});
async function navigate(key: PreviewPageKey) {
  window.history.replaceState(null, "", pageHash(key));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await nextTick();
  await nextTick();
}
async function click(selector: string, label: string) {
  const target = wrapper
    .findAll(`${selector} button`)
    .find((button) => button.text() === label);
  expect(target, `${selector}: ${label}`).toBeTruthy();
  await target!.trigger("click");
  await nextTick();
}

describe("preview navigation proposal", () => {
  it("owns warehouse and damage pages under Inventory and uses direct links for other destinations", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await nextTick();
    expect(
      wrapper.findAll(".nav-group > button").map((button) => button.text()),
    ).toEqual(["首页", "库存", "货物流动", "借用", "报表"]);
    expect(
      wrapper.findAll(".nav-children button").map((button) => button.text()),
    ).toEqual(["库存列表", "效期批次", "仓库", "损坏待处理"]);
    for (const [key, label] of [
      ["warehouse-detail/overview", "仓库"],
      ["pending/actionable", "损坏待处理"],
      ["expiry/expired", "效期批次"],
    ] as const) {
      await navigate(key);
      expect(wrapper.get(".nav-group > button.active").text()).toBe("库存");
      expect(wrapper.get('.nav-children [aria-current="page"]').text()).toBe(
        label,
      );
    }
    await click(".sample-sidebar nav", "货物流动");
    expect(window.location.hash).toBe(pageHash("movement-items/list"));
    expect(wrapper.findAll(".browse-view-switch button")).toHaveLength(2);
    expect(
      wrapper
        .findAll(".nav-children button")
        .some((button) => button.text().includes("流动")),
    ).toBe(false);
    await navigate("recovery/session");
    expect(wrapper.find(".nav-group > button.active").exists()).toBe(false);
  });

  it("renders one mobile inventory subnav and no duplicate Movement, Loans, or More subnav", async () => {
    desktop = false;
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("inventory/list");
    expect(wrapper.findAll(".sample-mobile-nav button")).toHaveLength(5);
    expect(wrapper.findAll(".mobile-context button")).toHaveLength(4);
    for (const key of [
      "movement-items/list",
      "loan-items/outstanding",
      "more/index",
    ] as const) {
      await navigate(key);
      expect(wrapper.find(".mobile-context").exists()).toBe(false);
    }
    expect(wrapper.get('.preview-tools-link[aria-current="page"]').text()).toBe(
      "更多",
    );
  });

  it("preserves Movement search, single type, sort, and record status across views and breakpoint changes", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("movement-items/list");
    await wrapper
      .get('input[aria-label="搜索货物流动"]')
      .setValue("ITM-000128");
    await wrapper.get('select[aria-label="流动日期排序"]').setValue("oldest");
    await click(".browse-kind-tabs", "入库");
    expect(
      wrapper.findAll('.browse-kind-tabs [aria-pressed="true"]'),
    ).toHaveLength(1);
    await click(".browse-view-switch", "按记录");
    expect(window.location.hash).toBe(pageHash("movement-records/completed"));
    expect(
      (
        wrapper.get('input[aria-label="搜索货物流动"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("ITM-000128");
    expect(wrapper.get('.browse-kind-tabs [aria-pressed="true"]').text()).toBe(
      "入库",
    );
    await wrapper.get('select[aria-label="流动记录状态"]').setValue("draft");
    expect(wrapper.get(".browse-table tbody").text()).toContain(
      "MAT-STE-2026-00002",
    );
    await click(".browse-view-switch", "按物品");
    desktop = false;
    listeners.forEach((callback) => callback({ matches: false }));
    await nextTick();
    await click(".browse-view-switch", "按记录");
    expect(window.location.hash).toBe(pageHash("movement-records/draft"));
    expect(
      (
        wrapper.get('select[aria-label="流动日期排序"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("newest");
    expect(reviewSession.filters.movementItems.sort).toBe("oldest");
    expect(wrapper.findAll(".browse-view-switch")).toHaveLength(1);
  });

  it("filters all operation types without navigating and retains opening records in the adjustment filter", async () => {
    wrapper = mount(PreviewBrowsePages, {
      props: { route: "movement-records/completed" },
    });
    expect(wrapper.findAll(".browse-kind-tabs button")).toHaveLength(4);
    reviewSession.filters.movementScope.kinds = ["Opening"];
    await nextTick();
    expect(wrapper.get(".browse-table tbody").text()).toContain(
      "MAT-RECO-2026-00014",
    );
    expect(wrapper.get(".browse-table tbody").text()).not.toContain(
      "MAT-STE-2026-00009",
    );
    expect(wrapper.emitted("navigate")).toBeUndefined();
    reviewSession.filters.movementScope.kinds = ["Repair"];
    await nextTick();
    expect(wrapper.find(".browse-empty").exists()).toBe(true);
    await click(".browse-kind-tabs", "全部");
    expect(wrapper.findAll(".browse-table tbody tr").length).toBeGreaterThan(1);
  });

  it("keeps Loan views separate from outcomes and remembers each view's status", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("loan-items/damaged");
    await wrapper.get('input[aria-label="搜索借用"]').setValue("清洁");
    expect(wrapper.get('[aria-label="借用状态"]').text()).not.toContain(
      "借用记录",
    );
    await click(".browse-view-switch", "按记录");
    expect(window.location.hash).toBe(pageHash("loan-records/all"));
    await wrapper.get('select[aria-label="借用状态"]').setValue("settled");
    await click(".browse-view-switch", "按物品");
    expect(window.location.hash).toBe(pageHash("loan-items/damaged"));
    await click(".browse-view-switch", "按记录");
    expect(window.location.hash).toBe(pageHash("loan-records/settled"));
    expect(
      (wrapper.get('input[aria-label="搜索借用"]').element as HTMLInputElement)
        .value,
    ).toBe("清洁");
  });

  it("shows grouped More tools, keeps review-only examples out, and restores focus after installation help", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("more/index");
    const more = wrapper.get(".preview-utility-page");
    expect(more.text()).toContain("工作工具");
    for (const label of [
      "损坏待处理",
      "仓库设置示例",
      "会话恢复示例",
      "登录完成",
      "/reports",
    ])
      expect(more.text()).not.toContain(label);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const install = more
      .findAll("button")
      .find((button) => button.text().startsWith("安装到手机"))!;
    (install.element as HTMLButtonElement).focus();
    await install.trigger("click");
    expect(document.body.style.overflow).toBe("hidden");
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await nextTick();
    expect(document.activeElement).toBe(install.element);
    expect(document.body.style.overflow).toBe("");
    await navigate("settings/density");
    await wrapper.get(".preview-back").trigger("click");
    expect(window.location.hash).toBe(pageHash("more/index"));
  });

  it("returns from record detail to its filtered list without duplicating the list in the detail page", async () => {
    wrapper = mount(PreviewApp, { attachTo: document.body });
    await navigate("movement-records/completed");
    await click(".browse-kind-tabs", "入库");
    const record = wrapper
      .findAll(".browse-row-link")
      .find((button) => button.text().includes("MAT-STE-2026-00009"))!;
    await record.trigger("click");
    expect(wrapper.find(".browse-view-switch").exists()).toBe(false);
    expect(wrapper.find(".browse-table").exists()).toBe(false);
    expect(wrapper.get(".browse-detail-card").text()).toContain(
      "MAT-STE-2026-00009",
    );
    await wrapper.get(".preview-back").trigger("click");
    expect(window.location.hash).toBe(pageHash("movement-records/completed"));
    expect(wrapper.get('.browse-kind-tabs [aria-pressed="true"]').text()).toBe(
      "入库",
    );
  });

  it("projects edits, deletion, and confirmation from one draft source across contextual views", async () => {
    wrapper = mount(PreviewBrowsePages, {
      props: { route: "movement-records/draft" },
    });
    const draft = reviewSession.drafts.find(
      (row) => row.name === "MAT-STE-2026-00001",
    )!;
    draft.lines[0].qty = 3;
    await nextTick();
    expect(
      reviewMovementRows().find((row) => row.name === draft.name)?.qty,
    ).toBe(3);
    await wrapper
      .findAll(".browse-row-link")
      .find((button) => button.text().includes(draft.name))!
      .trigger("click");
    expect(reviewSession.selectedDraftName).toBe(draft.name);
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-form",
      "Loan",
    ]);
    submitDraft("Loan", draft.name);
    await nextTick();
    expect(wrapper.get(".browse-table tbody").text()).not.toContain(draft.name);
    expect(
      reviewMovementRows().filter((row) => row.name === draft.name),
    ).toMatchObject([{ docstatus: 1, qty: 3 }]);
    await wrapper.setProps({ route: "loan-records/open" });
    expect(wrapper.text()).toContain(draft.name);
    await wrapper
      .findAll(".browse-card-main")
      .find((button) => button.text().includes(draft.name))!
      .trigger("click");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "loan-detail",
      "selected",
    ]);
    const empty = createDraft("Damage");
    await wrapper.setProps({ route: "movement-records/draft" });
    expect(wrapper.text()).toContain(empty.name);
    reviewSession.drafts.splice(reviewSession.drafts.indexOf(empty), 1);
    await nextTick();
    expect(wrapper.text()).not.toContain(empty.name);
  });

  it("shows a missing record instead of another record after deleting a draft", async () => {
    const index = reviewSession.drafts.findIndex(
      (draft) => draft.name === "MAT-STE-2026-00017",
    );
    reviewSession.drafts.splice(index, 1);
    wrapper = mount(PreviewBrowsePages, {
      props: { route: "movement-records/workspace-detail" },
    });
    expect(wrapper.text()).toContain("这条记录已不存在");
    expect(wrapper.find(".browse-detail-card").exists()).toBe(false);
    await click(".browse-empty", "返回记录列表");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-records",
      "completed",
    ]);
  });

  it("keeps hierarchy parent/child selection and keyboard search usable", async () => {
    wrapper = mount(PreviewHierarchyFilter, {
      props: {
        modelValue: ["room"],
        title: "仓库",
        placeholder: "搜索仓库",
        options: [
          { name: "room", label: "斋堂", is_group: true },
          { name: "a", parent: "room", label: "A-01" },
          { name: "b", parent: "room", label: "A-02" },
        ],
      },
      attachTo: document.body,
    });
    expect(wrapper.findAll(".hierarchy-list li")).toHaveLength(3);
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["b"]]);
    await wrapper.setProps({ modelValue: ["b"] });
    expect(
      (wrapper.get('input[type="checkbox"]').element as HTMLInputElement)
        .indeterminate,
    ).toBe(true);
    await wrapper.get('input[type="search"]').setValue("A-02");
    expect(wrapper.findAll(".hierarchy-list li")).toHaveLength(2);
    await wrapper
      .get('input[type="search"]')
      .trigger("keydown", { key: "Escape" });
    expect(wrapper.findAll(".hierarchy-list li")).toHaveLength(3);
  });
});
