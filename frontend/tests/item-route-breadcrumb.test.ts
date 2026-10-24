import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import RouteBreadcrumbs from "../src/components/RouteBreadcrumbs.vue";
import { routeRecords } from "../src/lib/routeRegistry";
import ApplicationShell from "../src/components/ApplicationShell.vue";
import {
  provideInventoryServices,
  createReferenceData,
  type InventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  if (originalScrollIntoView)
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("shows a loaded item name in its routed breadcrumb", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const reference = createReferenceData();
  Object.assign(reference, { site: "breadcrumb-test", user: "manager" });
  const item = {
    item_code: "ITM-000001",
    item_name: "活动周转箱",
    item_group: "法会用品",
    stock_uom: "Nos",
    description: "",
    version: "v1",
    has_batch_no: false,
    has_expiry_date: false,
    can_edit: true,
    barcodes: [],
    uoms: [{ uom: "Nos", conversion_factor: 1 }],
    attachments: [],
    images: [],
    stock: [],
  };
  const call = vi.fn(async (endpoint: string) => {
    if (endpoint === "catalog.operation_item") return item;
    if (
      endpoint === "browse.movement_history" ||
      endpoint === "browse.loan_item_history"
    )
      return { rows: [], matched_count: 0, next_start: null };
    if (endpoint === "native_files.attachments") return [];
    if (endpoint === "table_preferences.get_column_preferences")
      return undefined;
    return [];
  });
  const services = {
    call,
    report: vi.fn(),
    upload: vi.fn(),
  } as unknown as InventoryServices;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeRecords,
  });
  const host = defineComponent({
    setup() {
      provideInventoryServices(services, reference);
      return () =>
        h(ApplicationShell, null, {
          default: () => h("main", [h(RouteBreadcrumbs), h(RouterView)]),
        });
    },
  });
  const wrapper = mount(host, {
    attachTo: document.body,
    global: { plugins: [router] },
  });
  wrappers.push(wrapper);
  await router.push({ name: "item-detail", params: { code: item.item_code } });
  await router.isReady();
  await flushPromises();
  expect(call).toHaveBeenCalledWith(
    "catalog.operation_item",
    { item_code: item.item_code },
    expect.any(AbortSignal),
  );
  expect(wrapper.get('[aria-label="面包屑"]').text()).toContain("活动周转箱");
  expect(wrapper.get('[aria-label="面包屑"]').text()).not.toContain(
    item.item_code,
  );
  await router.replace({ query: { tab: "batches" } });
  await flushPromises();
  expect(wrapper.get('[aria-label="面包屑"]').text()).toContain("活动周转箱");
  expect(wrapper.get('[aria-label="面包屑"]').text()).not.toContain(
    item.item_code,
  );
});

it("hides top-level phone breadcrumbs, keeps detail breadcrumbs, and marks the Stock tab", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const reference = createReferenceData();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeRecords,
  });
  const host = defineComponent({
    setup() {
      provideInventoryServices(
        { call: vi.fn(async () => []), report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(ApplicationShell, null, { default: () => h("main") });
    },
  });
  const wrapper = mount(host, {
    attachTo: document.body,
    global: { plugins: [router] },
  });
  wrappers.push(wrapper);
  await router.push({ name: "stock" });
  await router.isReady();
  await flushPromises();
  expect(wrapper.find('[aria-label="面包屑"]').exists()).toBe(false);
  expect(
    wrapper.get(".mobile-context").get('a[aria-current="page"]').text(),
  ).toBe("库存");
  await router.push({ name: "item-detail", params: { code: "ITM-000001" } });
  await flushPromises();
  expect(wrapper.find('[aria-label="面包屑"]').exists()).toBe(true);
});
