import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import PreviewBrowsePages from "./support/FixtureHostBrowsePages.vue";
import OperationEditorPage from "../src/features/documents/OperationEditorPage.vue";
import PreviewFormPages from "./support/FixtureHostFormPages.vue";
import CountEditorPage from "../src/features/counts/CountEditorPage.vue";
import NativeVoucherLink from "../src/components/NativeVoucherLink.vue";
import ProductDetailPage from "../src/features/items/ProductDetailPage.vue";
import NativeRecordsPage from "../src/features/drafts/NativeRecordsPage.vue";
import NativeWarehousesPage from "../src/features/warehouses/NativeWarehousesPage.vue";
import PendingPage from "../src/features/pending/PendingPage.vue";
import LoanDetailPage from "../src/features/loans/LoanDetailPage.vue";
import ExpiryBrowsePage from "../src/features/expiry/ExpiryBrowsePage.vue";
import DashboardPage from "../src/features/dashboard/DashboardPage.vue";
import OperationBrowsePage from "../src/features/movements/OperationBrowsePage.vue";
import Attachments from "../src/components/Attachments.vue";
import { useAttachments } from "../src/features/attachments/useAttachments";
import {
  resetReviewSession,
  reviewSession,
  type PreviewPageKey,
} from "./support/reviewModel";
import { fixtureNativeCall } from "./support/fixtureNativeDocuments";
import { provideGalleryReference } from "./support/fixtureReference";
import {
  fixtureServices,
  fixtureDashboardScenario,
} from "./support/fixtureServices";
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  fixtureDashboardScenario.missingContext = false;
  resetReviewSession();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Gallery must not call live services");
    }),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});
async function render(route: PreviewPageKey) {
  const wrapper = mount(PreviewBrowsePages, {
    props: { route },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
describe("gallery renders native production components", () => {
  it.each([false, true])(
    "keeps all55 allocations mounted and validates the complete large receipt (invalid=%s)",
    async (invalid) => {
      const wrapper = mount(PreviewFormPages, {
        props: {
          page: "movement-form",
          variant: invalid ? "Receive-50-invalid" : "Receive-50",
        },
        attachTo: document.body,
      });
      wrappers.push(wrapper);
      await flushPromises();
      const controller =
        wrapper.getComponent(OperationEditorPage).vm.controller;
      expect(controller.draft.value.items).toHaveLength(55);
      expect(wrapper.findAll("[data-line-id]")).toHaveLength(55);
      await wrapper
        .get('input[placeholder="物品名称、编号、库位或批次"]')
        .setValue("PREVIEW-50-001");
      expect(wrapper.findAll("[data-line-id]")).toHaveLength(55);
      await controller.review();
      if (invalid) {
        expect(controller.reviewOpen.value).toBe(false);
        expect(controller.showError.value).toBe(true);
        expect(controller.state.identity).toBeUndefined();
      } else {
        expect(controller.reviewOpen.value).toBe(true);
        expect(
          document.body.querySelector('[role="dialog"]')?.textContent,
        ).toContain("55 条明细");
        expect(controller.draft.value.items).toHaveLength(55);
      }
      expect(fetch).not.toHaveBeenCalled();
    },
    10_000,
  );
  it.each([
    ["dashboard/overview", DashboardPage],
    ["item-detail/overview", ProductDetailPage],
    ["drafts/open", NativeRecordsPage],
    ["counts/records", NativeRecordsPage],
    ["warehouses/tree", NativeWarehousesPage],
    ["pending/actionable", PendingPage],
    ["expiry/soon", ExpiryBrowsePage],
    ["loan-detail/outstanding", LoanDetailPage],
    ["movement-items/list", OperationBrowsePage],
    ["movement-records/completed", OperationBrowsePage],
  ] as const)(
    "uses shared presentation for %s without HTTP",
    async (route, component) => {
      const wrapper = await render(route as PreviewPageKey);
      expect(wrapper.findComponent(component).exists()).toBe(true);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["entry-detail", "workspace-detail", "selected"])(
    "loads native-shaped movement identity for %s",
    async (variant) => {
      const wrapper = await render(
        `movement-records/${variant}` as PreviewPageKey,
      );
      const page = wrapper.getComponent(OperationEditorPage);
      expect(page.vm.controller.state.identity?.doctype).toBe("Stock Entry");
      expect(page.vm.controller.state.server?.name).toBeTruthy();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("uses shared opening/count and unsupported-native-voucher displays", async () => {
    const opening = await render("movement-records/opening");
    expect(
      opening.getComponent(CountEditorPage).vm.controller.opening.value,
    ).toBe(true);
    expect(opening.text()).toContain("期初库存");
    const external = await render("movement-records/external");
    expect(external.getComponent(NativeVoucherLink).props("doctype")).toBe(
      "Purchase Receipt",
    );
    expect(external.get("a").attributes("href")).toContain(
      "/app/purchase-receipt/",
    );
  });
  it("resets native-shaped mutations between review sessions", async () => {
    const original = (await fixtureNativeCall("native_api.load_document", {
      doctype: "Stock Entry",
      name: "MAT-STE-2026-00012",
    })) as any;
    await fixtureNativeCall("native_api.save_document", {
      doctype: original.doctype,
      name: original.name,
      version: original.version,
      data: { items: original.items.map((row: any) => ({ ...row, qty: 999 })) },
    });
    resetReviewSession();
    const restored = (await fixtureNativeCall("native_api.load_document", {
      doctype: original.doctype,
      name: original.name,
    })) as any;
    expect(restored.items[0].qty).toBe(original.items[0].qty);
    expect(restored.version).toBe(original.version);
  });
  it("keeps gallery File identity private-shaped while displaying only local bytes", async () => {
    let files!: ReturnType<typeof useAttachments>;
    const child = defineComponent({
      setup() {
        files = useAttachments({
          account: "gallery-reviewer",
          currentAccount: () => "gallery-reviewer",
          writable: () => true,
          parent: () => ({
            doctype: "Item",
            name: reviewSession.selectedItemCode,
          }),
        });
        return () => h(Attachments, { controller: files, imagesOnly: true });
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideGalleryReference();
          return () => h(child);
        },
      }),
    );
    wrappers.push(wrapper);
    files.add([
      new File(["sample bytes"], "sample.png", { type: "image/png" }),
    ]);
    await vi.waitFor(() => expect(files.files[0]?.state).toBe("ready"));
    expect(files.files[0]?.url).toMatch(/^data:image\/png/);
    const native = await fixtureServices.call<any[]>(
      "native_files.attachments",
      { doctype: "Item", name: reviewSession.selectedItemCode },
    );
    expect(native[0].file_url).toMatch(/^\/private\/files\//);
    expect(native[0].is_private).toBe(1);
    await files.remove(files.files[0]!);
    expect(files.files).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("renders named dashboard records and activity context separately from fallback examples", async () => {
  const wrapper = await render("dashboard/overview");
  const rows = wrapper.findAll(".browse-rank-row");
  const movements = rows.filter((row) => row.text().includes("MAT-STE"));
  expect(movements.length).toBeGreaterThan(0);
  expect(movements.some((row) => row.text().includes("库存记录"))).toBe(false);
  expect(movements.some((row) => !row.text().includes("未关联活动"))).toBe(
    true,
  );
  const named = movements[0]!
    .get("span")
    .element.firstChild!.textContent!.trim();
  expect(named.length).toBeGreaterThan(0);
  fixtureDashboardScenario.missingContext = true;
  await wrapper.getComponent(DashboardPage).vm.controller.refresh();
  await flushPromises();
  expect(wrapper.text()).toContain("库存记录");
  expect(wrapper.text()).toContain("未关联活动");
});
