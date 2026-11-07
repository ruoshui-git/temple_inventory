// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createReferenceData,
  provideInventoryServices,
  type ReferenceData,
  emptyCapabilities,
} from "../src/services/contracts";
import { useActivitiesController } from "../src/features/activities/useActivitiesController";
import ActivitiesView from "../src/features/activities/ActivitiesView.vue";
import NativeRecordsPage from "../src/features/drafts/NativeRecordsPage.vue";
import { openColumnSettings, showPhoneTable } from "./support/phoneTableView";

// 列表 rows and the 表格 table of one page share one 显示字段 selection: hiding a field in the
// panel must remove it from both, and the layout choice must survive a remount.
const wrappers: VueWrapper[] = [];
// 显示字段 choices are cached per site and account, so each test gets its own site and no hidden
// field leaks into the next test.
let testSite = "record-site";
let siteSeq = 0;
beforeEach(() => {
  localStorage.clear();
  testSite = `record-site-${++siteSeq}`;
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function referenceData(): ReferenceData {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: testSite,
    siteDate: "2026-10-23",
    units: [{ name: "Nos", label: "个" }],
    activityTypes: [{ value: "TYPE-A", label: "分发", enabled: true }],
    capabilities: {
      ...emptyCapabilities(),
      stock_entry: { ...emptyCapabilities().stock_entry, write: true },
      stock_reconciliation: {
        ...emptyCapabilities().stock_reconciliation,
        write: true,
      },
    },
  });
  return reference;
}

function stubDesktop(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function panelInput(label: string) {
  const panel = document.querySelector(".data-table-column-panel");
  const item = [...(panel?.querySelectorAll("li label") ?? [])].find(
    (element) => element.textContent?.trim() === label,
  );
  return item?.querySelector("input") as HTMLInputElement;
}

/** Hides one field through 显示字段: the inline summary trigger for 列表 rows, or the table's own. */
async function hideField(wrapper: VueWrapper, label: string) {
  expect(await openColumnSettings(wrapper)).toBe(true);
  expect(panelInput(label)).toBeTruthy();
  panelInput(label).click();
  await flushPromises();
  expect(panelInput(label).checked).toBe(false);
}

async function showTable(wrapper: VueWrapper) {
  expect(await showPhoneTable(wrapper)).toBe(true);
}

/** Opens the 更多操作 menu, checks that `expected` is in it, and returns every button label shown. */
async function overflowLabels(wrapper: VueWrapper, expected: string) {
  const menu = wrapper.get('[aria-label="更多操作"]');
  await menu.trigger("click");
  await flushPromises();
  const labels = [...document.body.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
  expect(labels).toContain(expected);
  await menu.trigger("click");
  await flushPromises();
  return labels;
}

function countOf(text: string, needle: string) {
  return text.split(needle).length - 1;
}

function track(wrapper: VueWrapper) {
  wrappers.push(wrapper);
  return wrapper;
}

const activityRow = {
  id: "ACT-A",
  title: "活动名称",
  activity_type: "TYPE-A",
  start_date: "2026-10-01",
  status: "Active",
  modified: "2026-10-20 08:00:00",
};

function mountActivities(rows: Record<string, unknown>[], navigate = vi.fn()) {
  const reference = referenceData();
  const report = vi.fn(async (query) => ({
    query,
    scope: query.scope,
    rows,
    matched_count: rows.length,
    next_start: null,
    table: "metadata",
    columns: [],
    tables: [{ id: "metadata", label: "活动", count: 1 }],
    summary: [],
    snapshot: "2026-10-23",
    period: { key: "all", date_from: "", date_to: "" },
  }));
  const call = vi.fn(async () => null);
  const props = reactive({ mode: "list" as const });
  const child = defineComponent({
    setup() {
      const controller = useActivitiesController(
        props as never,
        navigate,
        vi.fn(),
        vi.fn(),
      );
      return () =>
        h(ActivitiesView, { controller, mode: "list", active: true });
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call: call as never, report: report as never, upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h("div") } },
      {
        path: "/activities/:name",
        name: "activity-detail",
        component: { render: () => h("div") },
      },
      {
        path: "/activities/types",
        name: "activity-types",
        component: { render: () => h("div") },
      },
      {
        path: "/movements",
        name: "movements",
        component: { render: () => h("div") },
      },
      { path: "/loans", name: "loans", component: { render: () => h("div") } },
    ],
  });
  return { root, router };
}

async function mountActivityPage(
  rows: Record<string, unknown>[] = [activityRow],
  navigate?: ReturnType<typeof vi.fn>,
) {
  const { root, router } = mountActivities(rows, navigate);
  await router.push("/");
  await router.isReady();
  const wrapper = track(mount(root, { global: { plugins: [router] } }));
  await flushPromises();
  return wrapper;
}

const nativeRow = {
  id: "native-one",
  doctype: "Stock Reconciliation",
  document: "COUNT-A",
  kind: "Reconcile",
  docstatus: 1,
  date: "2026-10-16",
  time: "10:01:02",
  allocation_count: 2,
  item_count: 2,
  document_count: 1,
  item_name: "法会供灯",
  whole: {
    version: "v1",
    editable: false,
    line_count: 2,
    item_count: 2,
    quantities: [{ uom: "Nos", qty: 2 }],
    gains: [{ uom: "Nos", qty: 1 }],
    losses: [{ uom: "Nos", qty: -1 }],
    branches: [],
    original_loans: [],
  },
};

function mountRecords(mode: "drafts" | "counts", rows = [nativeRow]) {
  const reference = referenceData();
  const call = vi.fn(async () => ({
    rows,
    matched_count: rows.length,
    next_start: null,
    snapshot: "now",
  }));
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() } as never,
        reference,
      );
      return () => h(NativeRecordsPage, { mode });
    },
  });
  return track(mount(root));
}

describe("活动 browse rows and table share 显示字段", () => {
  it("hides a field from both the row and the table, and never shows actions in rows", async () => {
    const wrapper = await mountActivityPage();
    const rows = () => wrapper.get(".activity-row-list").text();
    expect(rows()).toContain("活动类型");
    expect(rows()).toContain("分发");
    expect(rows()).not.toContain("关联流动");
    expect(
      wrapper.find(".activity-row-list .activity-kind-summary").exists(),
    ).toBe(false);

    await hideField(wrapper, "活动类型");
    expect(rows()).not.toContain("活动类型");
    expect(rows()).toContain("活动名称");

    await showTable(wrapper);
    const headers = wrapper
      .findAll(".activity-list-scroll thead th")
      .map((th) => th.text());
    expect(headers.some((text) => text.includes("活动类型"))).toBe(false);
    expect(headers.some((text) => text.includes("活动名称"))).toBe(true);
  });

  it("keeps the phone 表格视图 toggle and 显示字段 in the summary row, not the 更多操作 menu", async () => {
    const phone = await mountActivityPage();
    const controls = phone.get(".browse-summary-controls");
    expect(controls.find('button[aria-label="表格视图"]').exists()).toBe(true);
    expect(controls.find(".data-table-column-trigger").exists()).toBe(true);
    expect(phone.get(".browse-result-summary-label").text()).toBe("1 个活动");
    const labels = await overflowLabels(phone, "导出");
    expect(labels).not.toContain("以表格显示");
    expect(labels).not.toContain("显示字段");
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    stubDesktop(true);
    const desktop = await mountActivityPage();
    expect(
      desktop
        .find('.browse-summary-controls button[aria-label="表格视图"]')
        .exists(),
    ).toBe(false);
    expect(desktop.get(".browse-result-summary-label").text()).toContain(
      "标签数字为全部已提交单据",
    );
    expect(desktop.find(".activity-row-list").exists()).toBe(false);
    expect(desktop.find(".activity-list-scroll table").exists()).toBe(true);
  });

  it("keeps the chosen layout across a remount", async () => {
    const first = await mountActivityPage();
    expect(first.find(".activity-row-list").exists()).toBe(true);
    await showTable(first);
    expect(first.find(".activity-list-scroll table").exists()).toBe(true);
    first.unmount();
    wrappers.splice(wrappers.indexOf(first), 1);

    const second = await mountActivityPage();
    expect(second.find(".activity-row-list").exists()).toBe(false);
    expect(second.find(".activity-list-scroll table").exists()).toBe(true);
  });
});

describe("盘点记录 rows and table share 显示字段", () => {
  it("hides a field from both the row and the table", async () => {
    const wrapper = mountRecords("counts");
    await flushPromises();
    const rows = () => wrapper.get(".native-record-row-list").text();
    expect(rows()).toContain("物品种数");
    expect(rows()).toContain("COUNT-A");

    await hideField(wrapper, "物品种数");
    expect(rows()).not.toContain("物品种数");

    await showTable(wrapper);
    const headers = wrapper.findAll("thead th").map((th) => th.text());
    expect(headers.some((text) => text.includes("物品种数"))).toBe(false);
    expect(headers.some((text) => text.includes("增加"))).toBe(true);
  });

  it("keeps the phone 表格视图 toggle and 显示字段 in the summary row, and no layout toggle on desktop", async () => {
    const phone = mountRecords("counts");
    await flushPromises();
    const controls = phone.get(".browse-summary-controls");
    expect(controls.find('button[aria-label="表格视图"]').exists()).toBe(true);
    expect(controls.find(".data-table-column-trigger").exists()).toBe(true);
    const labels = await overflowLabels(phone, "导出");
    expect(labels).not.toContain("以表格显示");
    expect(labels).not.toContain("显示字段");
    expect(await showPhoneTable(phone)).toBe(true);
    expect(phone.find(".native-record-row-list").exists()).toBe(false);
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    stubDesktop(true);
    const desktop = mountRecords("counts");
    await flushPromises();
    expect(
      desktop
        .find('.browse-summary-controls button[aria-label="表格视图"]')
        .exists(),
    ).toBe(false);
  });

  it("keeps the chosen layout across a remount", async () => {
    const first = mountRecords("counts");
    await flushPromises();
    await showTable(first);
    expect(first.find(".native-record-row-list").exists()).toBe(false);
    first.unmount();
    wrappers.splice(wrappers.indexOf(first), 1);

    const second = mountRecords("counts");
    await flushPromises();
    expect(second.find(".native-record-row-list").exists()).toBe(false);
    expect(second.find('[aria-label="库存记录"] table').exists()).toBe(true);
  });
});

describe("草稿 rows and table share 显示字段", () => {
  it("hides a field from both the phone row and the table, and keeps actions out of rows", async () => {
    const wrapper = mountRecords("drafts");
    await flushPromises();
    const rows = () => wrapper.get(".draft-entry-row-list").text();
    expect(rows()).toContain("明细摘要");
    expect(rows()).not.toContain("继续编辑");

    await hideField(wrapper, "明细摘要");
    expect(rows()).not.toContain("明细摘要");

    await showTable(wrapper);
    const table = wrapper.get('[aria-label="草稿列表"]');
    const headers = table.findAll("thead th").map((th) => th.text());
    expect(headers.some((text) => text.includes("明细摘要"))).toBe(false);
    expect(headers.some((text) => text.includes("草稿"))).toBe(true);
    expect(table.text()).toContain("继续编辑");
    expect(table.text()).not.toContain("删除");
  });

  it("keeps the phone 表格视图 toggle and 显示字段 in the summary row", async () => {
    const wrapper = mountRecords("drafts");
    await flushPromises();
    const controls = wrapper.get(".browse-summary-controls");
    expect(controls.find('button[aria-label="表格视图"]').exists()).toBe(true);
    expect(controls.find(".data-table-column-trigger").exists()).toBe(true);
    const labels = await overflowLabels(wrapper, "刷新");
    expect(labels).not.toContain("以表格显示");
    expect(labels).not.toContain("显示字段");
  });

  it("keeps the desktop list without a layout toggle", async () => {
    stubDesktop(true);
    const wrapper = mountRecords("drafts");
    await flushPromises();
    expect(
      wrapper
        .find('.browse-summary-controls button[aria-label="表格视图"]')
        .exists(),
    ).toBe(false);
    expect(wrapper.find(".draft-entry-list").exists()).toBe(true);
  });
});

// jsdom has no layout, so every [data-clamp] text reads as cut off and 更多 appears.
function clampEverything() {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 40,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 20,
  });
}

function clickButton(text: string) {
  const button = [...document.body.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(button, `button ${text}`).toBeTruthy();
  button?.click();
}

describe("更多 sheet and empty states in 活动, 草稿 and 盘点记录 rows", () => {
  beforeEach(() => clampEverything());
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  });

  it("opens every field of a clamped 活动 row in 更多, and 打开 opens the activity", async () => {
    const navigate = vi.fn();
    const wrapper = await mountActivityPage(undefined, navigate);
    await wrapper.get(".activity-row-list .card-fields-more").trigger("click");
    await flushPromises();
    const sheet = document.body.querySelector(".row-fields-sheet");
    expect(sheet?.textContent).toContain("活动类型");
    expect(sheet?.textContent).toContain("分发");
    clickButton("打开");
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith("detail", "ACT-A");
    expect(document.body.querySelector(".row-fields-sheet")).toBeNull();
  });

  it("shows the 活动 empty wording once in phone rows when nothing matches", async () => {
    const wrapper = await mountActivityPage([]);
    expect(wrapper.find(".browse-card-item").exists()).toBe(false);
    expect(
      countOf(wrapper.text(), "没有符合条件的活动。可恢复默认筛选或新建活动。"),
    ).toBe(1);
  });

  it("opens every field of a clamped 草稿 row in 更多, and 打开 opens the draft", async () => {
    const wrapper = mountRecords("drafts");
    await flushPromises();
    await wrapper
      .get(".draft-entry-row-list .card-fields-more")
      .trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector(".row-fields-sheet")?.textContent,
    ).toContain("明细摘要");
    clickButton("打开");
    await flushPromises();
    expect(
      wrapper.findComponent(NativeRecordsPage).emitted("openDocument")?.[0],
    ).toEqual(["Stock Reconciliation", "COUNT-A"]);
  });

  it("shows the 草稿 empty wording once in phone rows and once on desktop", async () => {
    const phone = mountRecords("drafts", []);
    await flushPromises();
    expect(phone.find(".draft-entry-row-list").exists()).toBe(true);
    expect(countOf(phone.text(), "没有符合条件的草稿。")).toBe(1);
    phone.unmount();
    wrappers.splice(wrappers.indexOf(phone), 1);

    stubDesktop(true);
    const desktop = mountRecords("drafts", []);
    await flushPromises();
    expect(desktop.find(".draft-entry-list").exists()).toBe(true);
    expect(countOf(desktop.text(), "没有符合条件的草稿。")).toBe(1);
  });

  it("opens every field of a clamped 盘点记录 row in 更多, and 打开 opens the record", async () => {
    const wrapper = mountRecords("counts");
    await flushPromises();
    await wrapper
      .get(".native-record-row-list .card-fields-more")
      .trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector(".row-fields-sheet")?.textContent,
    ).toContain("物品种数");
    clickButton("打开");
    await flushPromises();
    expect(
      wrapper.findComponent(NativeRecordsPage).emitted("openDocument")?.[0],
    ).toEqual(["Stock Reconciliation", "COUNT-A"]);
  });

  it("shows the 盘点记录 empty wording once in phone rows", async () => {
    const wrapper = mountRecords("counts", []);
    await flushPromises();
    expect(wrapper.find(".native-record-row-list").exists()).toBe(true);
    expect(countOf(wrapper.text(), "没有符合条件的记录")).toBe(1);
  });
});
