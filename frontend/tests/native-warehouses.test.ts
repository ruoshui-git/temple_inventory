import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import NativeWarehousesPage from "../src/features/warehouses/NativeWarehousesPage.vue";
import PreviewBrowsePages from "./support/FixtureHostBrowsePages.vue";
import { resetReviewSession } from "./support/reviewModel";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  createRecoveryStore,
  type RecoverySnapshot,
} from "../src/lib/browserRecovery";
import type { NativeWarehouse } from "../src/features/warehouses/useNativeWarehouses";
const wrappers: VueWrapper[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  document.body.innerHTML = "";
});
const root: NativeWarehouse = {
  name: "ROOT",
  label: "寺院仓库",
  parent: "",
  type: "Location",
  is_group: true,
  disabled: false,
  protected: true,
  can_edit: false,
  lft: 1,
  rgt: 8,
  version: "root-v1",
};
const physical: NativeWarehouse = {
  ...root,
  name: "PHYSICAL",
  parent: "ROOT",
  label: "实体库房",
  lft: 2,
  rgt: 7,
};
const room: NativeWarehouse = {
  ...root,
  name: "ROOM/A,1",
  label: "房间甲",
  parent: "PHYSICAL",
  type: "Room",
  is_group: false,
  protected: false,
  can_edit: true,
  lft: 3,
  rgt: 4,
  version: "room-v1",
};
const tree = {
  rows: [root, physical, room],
  physical_root: "PHYSICAL",
  company: "TEMPLE",
  can_create: true,
};
const stockRow = {
  id: "stock-a",
  item_code: "ITEM/A",
  item_name: "原生物品",
  warehouse: room.name,
  stock_qty: 4,
  stock_uom: "Nos",
};
function setup(
  props: Record<string, unknown> = {},
  call = vi.fn(async () => tree),
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "site",
    user: "manager",
    physicalLeaves: [room.name],
    capabilities: { "Stock Reconciliation": { create: true } },
  });
  const report = vi.fn(async (query) => ({
    query,
    table: query.view,
    rows: [stockRow],
    columns: Object.keys(stockRow),
    matched_count: 205,
    next_start: 30,
    snapshot: "now",
    summary: [{ stock_uom: "Nos", stock_qty: 999 }],
    period: { date_from: "", date_to: "" },
    tables: [{ id: query.view, label: "原生结果", count: 205 }],
  }));
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report, upload: vi.fn() } as never,
          reference,
        );
        return () => h(NativeWarehousesPage, props);
      },
    }),
  );
  wrappers.push(wrapper);
  const page = wrapper.findComponent(NativeWarehousesPage);
  return { wrapper, page, c: page.vm.controller, call, report, reference };
}
describe("shared native warehouse workspace", () => {
  it("loads metadata before querying an exact warehouse scope and retains full unit totals", async () => {
    const { c, wrapper, report, page } = setup();
    expect(wrapper.text()).toContain("正在读取仓库与权限");
    expect(report).not.toHaveBeenCalled();
    await flushPromises();
    expect(report.mock.calls[0]?.[0].scope.warehouses).toEqual(["PHYSICAL"]);
    expect(c.stock.result.total).toBe(205);
    expect(c.stock.result.summary[0]?.stock_qty).toBe(999);
    c.select(room.name);
    await flushPromises();
    expect(c.stockQuery.value.scope.warehouses).toEqual([room.name]);
    expect(wrapper.text()).toContain("999");
    expect(wrapper.text()).toContain("4 Nos");
    await wrapper.find(".browse-rank-row").trigger("click");
    expect(page.emitted("item")?.[0]).toEqual(["ITEM/A"]);
  });
  it("never substitutes a different warehouse or queries all stock for an unavailable deep link", async () => {
    const { c, wrapper, report } = setup({ name: "MISSING" });
    await flushPromises();
    expect(c.error.value).toContain("不存在或当前账户无权读取");
    expect(report).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("原生物品");
  });
  it("keeps Room meaning separate from group structure and protects system nodes", async () => {
    const { c, wrapper } = setup();
    await flushPromises();
    c.openEditor(physical);
    expect(c.dialogOpen.value).toBe(false);
    c.openEditor();
    await flushPromises();
    expect(c.form.warehouse_type).toBe("Room");
    expect(c.form.is_group).toBe(false);
    expect(document.body.textContent).toContain("房间 / 位置表示物理意义");
    c.form.label = "新房间";
    await flushPromises();
    expect(c.dirty.value).toBe(true);
    const leaving = c.requestLeave();
    expect(c.leaveOpen.value).toBe(true);
    c.finishLeave("stay");
    expect(await leaving).toBe(false);
    expect(c.form.label).toBe("新房间");
    expect(wrapper.findComponent(NativeWarehousesPage).exists()).toBe(true);
  });
  it("retains edits made during a native metadata save with the new native base version", async () => {
    let resolve!: (value: NativeWarehouse) => void;
    const call = vi.fn(async (endpoint) =>
      endpoint === "warehouses.save_warehouse"
        ? new Promise<NativeWarehouse>((done) => (resolve = done))
        : tree,
    );
    const { c } = setup({}, call);
    await flushPromises();
    c.openEditor(room);
    c.form.label = "送出名称";
    await flushPromises();
    const saving = c.save();
    c.form.label = "保存期间继续输入";
    await flushPromises();
    resolve({ ...room, label: "送出名称", version: "room-v2" });
    await saving;
    expect(
      call.mock.calls.find((args) => args[0] === "warehouses.save_warehouse"),
    ).toMatchObject([
      "warehouses.save_warehouse",
      {
        name: room.name,
        version: "room-v1",
        warehouse_type: "Room",
        is_group: false,
        label: "送出名称",
      },
    ]);
    expect(c.form.label).toBe("保存期间继续输入");
    expect(c.editing.value?.version).toBe("room-v2");
    expect(c.dialogOpen.value).toBe(true);
    const entry = createRecoveryStore("site", "manager", localStorage)
      .list()
      .entries.find((row) => row.values.label === "保存期间继续输入");
    expect(entry?.baseVersion).toBe("room-v2");
  });
  it("rejects recovery over a changed native warehouse and clears old-account metadata", async () => {
    const entry: RecoverySnapshot = {
      schema: 1,
      site: "site",
      account: "manager",
      editorKind: "Warehouse",
      editorId: "local-w",
      tabId: "tab",
      revision: 1,
      baseVersion: "room-v0",
      updatedAt: "now",
      pendingUploadReselection: false,
      values: {
        editingWarehouse: room.name,
        label: "旧输入",
        parent: "PHYSICAL",
        warehouse_type: "Room",
        is_group: false,
        disabled: false,
      },
    };
    createRecoveryStore("site", "manager", localStorage).save(entry);
    const { c, reference } = setup({ recoveryId: "local-w" });
    await flushPromises();
    await c.recover(entry);
    expect(c.recoveryError.value).toContain("原仓库已更改");
    expect(c.dialogOpen.value).toBe(false);
    expect(c.candidates.value).toHaveLength(1);
    reference.user = "another";
    await flushPromises();
    expect(c.tree.value).toBeUndefined();
    expect(c.candidates.value).toEqual([]);
  });
  it("renders the gallery warehouse tree with the shared controller and fixture service", async () => {
    resetReviewSession();
    const wrapper = mount(PreviewBrowsePages, {
      props: { route: "warehouses/tree" },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const c = wrapper.findComponent(NativeWarehousesPage).vm.controller;
    expect(c.error.value).toBe("");
    expect(c.visibleRows.value.length).toBeGreaterThan(0);
    const detail = mount(PreviewBrowsePages, {
      props: { route: "warehouse-detail/overview" },
    });
    wrappers.push(detail);
    await flushPromises();
    const history =
      detail.findComponent(NativeWarehousesPage).vm.controller.history.mainTable
        .value;
    expect(history?.rows.length).toBeGreaterThan(0);
    expect(
      history?.rows.every(
        (row) => row.kind && typeof row.stock_qty === "number" && row.stock_uom,
      ),
    ).toBe(true);
    expect(history?.rows.map((row) => row.date)).toEqual(
      history?.rows
        .map((row) => row.date)
        .sort()
        .reverse(),
    );
    c.openEditor();
    c.form.label = "图库新房间";
    await flushPromises();
    await c.save();
    await flushPromises();
    expect(c.formError.value).toBe("");
    expect(
      c.tree.value?.rows.some(
        (row) =>
          row.label === "图库新房间" && row.type === "Room" && !row.is_group,
      ),
    ).toBe(true);
  });
});
