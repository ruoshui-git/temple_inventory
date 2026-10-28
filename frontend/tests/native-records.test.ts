// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import NativeRecordsPage from "../src/features/drafts/NativeRecordsPage.vue";
import PreviewBrowsePages from "./support/FixtureHostBrowsePages.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  createRecoveryStore,
  type RecoverySnapshot,
} from "../src/lib/browserRecovery";
import { recoveryDestination } from "../src/lib/recoveryNavigation";
import { newReportQuery } from "../src/lib/reportContract";
import { resetReviewSession } from "./support/reviewModel";
const wrappers: VueWrapper[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  document.body.innerHTML = "";
});
const nativeRow = {
  id: "native-one",
  doctype: "Stock Entry",
  document: "STE/A,1",
  item_name: "法会供灯",
  kind: "Receive",
  docstatus: 0,
  date: "2026-10-16",
  time: "10:01:02",
  allocation_count: 2,
  item_count: 2,
  document_count: 1,
  whole: {
    version: "v1",
    editable: true,
    line_count: 2,
    item_count: 2,
    quantities: [
      { uom: "Nos", qty: 2 },
      { uom: "Kg", qty: 3 },
    ],
    branches: [],
    original_loans: [],
  },
};
const response = {
  rows: [nativeRow],
  matched_count: 205,
  next_start: 30,
  snapshot: "now",
};
const snapshot: RecoverySnapshot = {
  schema: 1,
  site: "site",
  account: "volunteer",
  tabId: "tab-a",
  editorId: "local-a",
  editorKind: "Stock Entry",
  revision: 1,
  updatedAt: "2026-10-16T10:00:00Z",
  values: { kind: "Receive", source: "保留的输入" },
  pendingUploadReselection: true,
};
function setup(
  call = vi.fn(async () => response),
  mode: "drafts" | "counts" = "drafts",
  query?: ReturnType<typeof newReportQuery>,
  routeQuery?: string,
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "site",
    siteDate: "2026-10-16",
    capabilities: { "Stock Reconciliation": { create: true } },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() } as never,
        reference,
      );
      return () =>
        h(NativeRecordsPage, { mode, initialQuery: query, routeQuery });
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  const page = wrapper.findComponent(NativeRecordsPage);
  return { wrapper, page, c: page.vm.controller, reference, call };
}
describe("native drafts and count records", () => {
  it("starts Drafts with the records sort contract when the route has no query", async () => {
    const { c, call } = setup();
    await flushPromises();
    expect(c.routeError.value).toBe("");
    expect(c.query.value).toMatchObject({
      dataset: "movements",
      view: "records",
      sortBy: "modified",
      sort: "desc",
      statuses: [0],
    });
    expect(call).toHaveBeenCalledWith(
      "browse.native_drafts",
      expect.objectContaining({
        query: expect.objectContaining({ view: "records", sortBy: "modified" }),
      }),
      expect.any(AbortSignal),
    );
  });
  it("uses a local BrowseToolbar search and exposes draft kind, type and sort filters", async () => {
    const { wrapper, c } = setup();
    await flushPromises();
    const search = wrapper.get<HTMLInputElement>(
      '.browse-persistent-search input[aria-label="搜索草稿、物品或活动"]',
    );
    await search.setValue("本地筛选");
    expect(c.query.value.search).toBe("");
    await wrapper.get('button[aria-haspopup="dialog"]').trigger("click");
    await flushPromises();
    for (const field of ["kindFilter", "typeFilter", "draftSort"])
      expect(
        document.querySelector(`[data-filter-field="${field}"]`),
      ).toBeTruthy();
  });

  it.each(["quantity", "name", "batch", "item_name"])(
    "resets retired sort field %s to the native records default while preserving filters",
    async (sortBy) => {
      const routeQuery = JSON.stringify({
        ...newReportQuery("movements"),
        view: "records",
        sortBy,
        search: "保留搜索",
      });
      const { wrapper, c, call } = setup(
        undefined,
        "drafts",
        undefined,
        routeQuery,
      );
      await flushPromises();
      expect(c.routeError.value).toBe("");
      expect(c.query.value).toMatchObject({
        view: "records",
        sortBy: "modified",
        search: "保留搜索",
        statuses: [0],
      });
      expect(call).toHaveBeenCalledWith(
        "browse.native_drafts",
        expect.objectContaining({
          query: expect.objectContaining({
            sortBy: "modified",
            view: "records",
          }),
        }),
        expect.any(AbortSignal),
      );
      expect(wrapper.text()).not.toContain("此视图不支持此排序字段");
    },
  );

  it("keeps complete document counts and separate unit quantities, then loads another page without losing rows", async () => {
    const call = vi.fn(async (_endpoint, args) =>
      args.start
        ? {
            ...response,
            rows: [{ ...nativeRow, id: "second", document: "SECOND" }],
            next_start: null,
          }
        : response,
    );
    const { wrapper, c, page } = setup(call);
    expect(wrapper.find(".skeleton-block--list").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("没有符合条件");
    await flushPromises();
    expect(call.mock.calls[0]?.slice(0, 2)).toMatchObject([
      "browse.native_drafts",
      { query: { statuses: [0], sortBy: "modified", view: "records" } },
    ]);
    expect(wrapper.text()).toContain("法会供灯 等 2 种物品");
    expect(wrapper.text()).toContain("草稿单据");
    expect(wrapper.get(".draft-title-link").text()).toBe("入库 · STE/A,1");
    expect(
      wrapper.get(".draft-title-link").attributes("disabled"),
    ).toBeUndefined();
    expect(
      wrapper
        .get(".draft-entry .browse-row-actions")
        .find("button")
        .attributes("disabled"),
    ).toBeUndefined();
    expect(wrapper.get(".draft-entry .browse-row-actions").text()).toContain(
      "继续编辑",
    );
    await wrapper.find(".draft-entry button").trigger("click");
    expect(page.emitted("openDocument")?.[0]).toEqual([
      "Stock Entry",
      "STE/A,1",
    ]);
    await c.load(true);
    expect(c.rows.value).toHaveLength(2);
    expect(c.total.value).toBe(205);
    expect(
      c.extraChips.value.find((chip) => chip.key === "statuses"),
    ).toBeUndefined();
  });
  it("merges server and browser drafts newest first with source tags and concise summaries", async () => {
    const newerSnapshot = {
      ...snapshot,
      updatedAt: "2026-10-16T10:02:00Z",
      values: {
        kind: "Receive",
        items: [
          { code: "ITEM-A", location: "WH-A" },
          { code: "ITEM-B", location: "WH-A" },
        ],
      },
    };
    createRecoveryStore("site", "volunteer", localStorage).save(newerSnapshot);
    const { wrapper, c } = setup();
    await flushPromises();
    expect(wrapper.findAll(".preview-browse-controls")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("份记录");
    expect(
      c.extraChips.value.find((chip) => chip.key === "statuses"),
    ).toBeUndefined();
    await wrapper.get('button[aria-haspopup="dialog"]').trigger("click");
    await flushPromises();
    const filters = Array.from(
      document.querySelectorAll<HTMLSelectElement>(
        '[data-filter-field="kindFilter"] select, [data-filter-field="typeFilter"] select, [data-filter-field="draftSort"] select',
      ),
    );
    expect(filters).toHaveLength(3);
    const entries = wrapper.findAll(".draft-entry");
    expect(entries).toHaveLength(2);
    expect(
      entries[0]?.find(".draft-entry-heading .draft-type-tag").exists(),
    ).toBe(true);
    expect(entries[0]?.find(".draft-entry-meta time").exists()).toBe(true);
    expect(entries[0]?.find(".draft-title-link").exists()).toBe(true);
    expect(
      entries[0]?.find(".browse-row-actions .ui-button").attributes("class"),
    ).toContain("ui-button--compact");
    expect(entries[0]?.text()).toContain("浏览器暂存");
    expect(entries[0]?.text()).toContain("2 种物品");
    expect(entries[1]?.text()).toContain("草稿单据");
    const kindSelect = document.querySelector<HTMLSelectElement>(
      '[data-filter-field="kindFilter"] select',
    )!;
    kindSelect.value = "入库";
    kindSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const typeSelect = document.querySelector<HTMLSelectElement>(
      '[data-filter-field="typeFilter"] select',
    )!;
    typeSelect.value = "browser";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
    expect(wrapper.findAll(".draft-entry")).toHaveLength(1);
    expect(wrapper.find(".draft-entry").text()).toContain("浏览器暂存");
  });
  it("preserves native and local input on stale-version deletion failure and rechecks the exact version", async () => {
    const store = createRecoveryStore("site", "volunteer", localStorage);
    store.save(snapshot);
    const call = vi.fn(async (endpoint) => {
      if (endpoint === "native_api.delete_document")
        throw new Error("记录已更改");
      return response;
    });
    const { c } = setup(call);
    await flushPromises();
    c.deleteTarget.value = c.rows.value[0];
    await c.removeNative();
    expect(call.mock.calls.at(-1)).toMatchObject([
      "native_api.delete_document",
      { doctype: "Stock Entry", name: "STE/A,1", version: "v1" },
    ]);
    expect(c.deleteError.value).toBe("记录已更改");
    expect(c.deleteTarget.value).toBeDefined();
    expect(c.rows.value).toHaveLength(1);
    expect(store.read("local-a")).toEqual(snapshot);
    c.stale.value = true;
    expect(c.canDelete(nativeRow)).toBe(false);
  });
  it("never removes a newer local revision and shows only the current account's browser entry", async () => {
    const store = createRecoveryStore("site", "volunteer", localStorage);
    store.save(snapshot);
    createRecoveryStore("site", "another", localStorage).save({
      ...snapshot,
      account: "another",
      editorId: "other",
    });
    const { c, reference, wrapper, page } = setup();
    await flushPromises();
    expect(c.localEntries.value).toHaveLength(1);
    const resume = wrapper
      .findAll(".draft-entry")
      .find((entry) => entry.text().includes("浏览器暂存"))!
      .findAll("button")
      .find((button) => button.text().includes("继续编辑"))!;
    await resume.trigger("click");
    expect(page.emitted("recover")?.[0]).toEqual([snapshot]);
    c.localTarget.value = snapshot;
    store.save({ ...snapshot, revision: 2, values: { source: "新输入" } });
    c.removeLocal();
    expect(c.localError.value).toContain("另一窗口更新");
    expect(store.read("local-a")?.revision).toBe(2);
    reference.user = "another";
    await flushPromises();
    expect(c.localEntries.value).toEqual([]);
    expect(c.rows.value).toEqual([]);
    expect(wrapper.text()).not.toContain("保留的输入");
  });
  it("keeps restrictive empty scopes and refuses incompatible datasets without fetching", async () => {
    const query = newReportQuery("movements");
    query.restrictAllocations = true;
    const accepted = setup(undefined, "drafts", query);
    await flushPromises();
    expect(accepted.call.mock.calls[0]?.slice(0, 2)).toMatchObject([
      "browse.native_drafts",
      { query: { restrictAllocations: true, allocationKeys: [] } },
    ]);
    const rejected = setup(vi.fn(), "drafts", newReportQuery("loans"));
    await flushPromises();
    expect(
      rejected.call.mock.calls.some(([endpoint]) =>
        String(endpoint).startsWith("browse."),
      ),
    ).toBe(false);
    expect(rejected.c.routeError.value).toBeTruthy();
    const counts = setup(undefined, "counts");
    await flushPromises();
    expect(counts.call.mock.calls[0]?.slice(0, 2)).toMatchObject([
      "browse.counts_page",
      { query: { dataset: "counts", statuses: [0, 1, 2] } },
    ]);
    expect(counts.wrapper.text()).toContain("数量一致的盘点不产生记录");
  });
  it("restores native identifiers and local editor IDs through distinct routes", () => {
    expect(
      recoveryDestination({
        ...snapshot,
        identity: { doctype: "Stock Entry", name: "STE/A,1" },
      }),
    ).toMatchObject({
      name: "movement-detail",
      params: { name: "STE/A,1" },
      query: { recovery: "local-a" },
    });
    expect(recoveryDestination(snapshot)).toMatchObject({
      name: "movement-new",
      params: { kind: "Receive" },
    });
    expect(
      recoveryDestination({
        ...snapshot,
        editorKind: "Item",
        values: { editingCode: "ITEM/A,1" },
      }),
    ).toMatchObject({ name: "item-edit", params: { code: "ITEM/A,1" } });
    expect(
      recoveryDestination({ ...snapshot, values: { kind: "Unknown" } }),
    ).toBeUndefined();
  });
  it("renders gallery drafts with the shared native list and native delete adapter", async () => {
    resetReviewSession();
    const wrapper = mount(PreviewBrowsePages, {
      props: { route: "drafts/open" },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const page = wrapper.findComponent(NativeRecordsPage),
      c = page.vm.controller;
    expect(c.error.value).toBe("");
    expect(c.rows.value.length).toBeGreaterThan(0);
    const selected = c.rows.value[0]!;
    c.deleteTarget.value = selected;
    await c.removeNative();
    await flushPromises();
    expect(c.deleteError.value).toBe("");
    expect(c.rows.value.some((row) => row.document === selected.document)).toBe(
      false,
    );
  });
});
