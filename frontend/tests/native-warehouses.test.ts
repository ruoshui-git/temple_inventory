// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import NativeWarehousesPage from "../src/features/warehouses/NativeWarehousesPage.vue";
import QuickExport from "../src/components/QuickExport.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type LocationNode,
} from "../src/services/contracts";
import { warehouseLabel, warehousePath } from "../src/lib/warehouseLabel";
import type { ReportQuery } from "../src/lib/reportContract";
import { fixtureServices } from "./support/fixtureServices";
import { provideGalleryReference } from "./support/fixtureReference";
import { resolveConfirm, useConfirm } from "../src/services/confirm";
const wrappers: VueWrapper[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  resolveConfirm(false);
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  document.body.innerHTML = "";
});
const node = (overrides: Partial<LocationNode>): LocationNode => ({
  name: "ROOT",
  label: "实体库房",
  local_label: "实体库房",
  short_label: "",
  full_label: "实体库房",
  path: "",
  search_text: "实体库房",
  kind: "system",
  owner: "",
  direct: false,
  storable: false,
  missing_direct: false,
  parent: "",
  is_group: true,
  disabled: false,
  lft: 1,
  rgt: 20,
  version: "v1",
  protected: true,
  can_edit: false,
  ...overrides,
});
const area = node({
  name: "AREA",
  label: "T2",
  local_label: "第二展区",
  full_label: "第二展区",
  path: "T2",
  kind: "area",
  parent: "ROOT",
  lft: 2,
  rgt: 15,
  protected: false,
  can_edit: true,
});
const room = node({
  name: "ROOM",
  label: "A02",
  local_label: "演示室甲",
  full_label: "演示室甲",
  path: "T2 / A02",
  search_text: "T2 A02 演示室甲",
  kind: "room",
  parent: "AREA",
  is_group: true,
  missing_direct: false,
  storable: true,
  lft: 3,
  rgt: 8,
  protected: false,
  can_edit: true,
  version: "room-v4",
});
const direct = node({
  name: "ROOM-DIRECT",
  label: "A02",
  local_label: "演示室甲",
  full_label: "演示室甲",
  path: "T2 / A02",
  search_text: "T2 A02 演示室甲",
  kind: "room",
  parent: "ROOM",
  owner: "ROOM",
  direct: true,
  is_group: false,
  storable: true,
  lft: 4,
  rgt: 5,
  protected: false,
  can_edit: false,
});
const shelf = node({
  name: "SHELF",
  label: "演示室甲 / 演示架1",
  local_label: "演示架1",
  full_label: "演示架1",
  path: "T2 / A02 / 演示架1",
  search_text: "T2 A02 演示架1",
  kind: "shelf",
  parent: "ROOM",
  is_group: false,
  storable: true,
  lft: 9,
  rgt: 10,
  protected: false,
  can_edit: true,
});
const systemRoot = node({
  name: "SYSTEM",
  label: "系统位置",
  local_label: "系统位置",
  full_label: "系统位置",
  path: "系统位置",
  search_text: "系统位置",
  kind: "system",
  parent: "ROOT",
  lft: 16,
  rgt: 21,
  protected: true,
  can_edit: false,
});
const leased = node({
  name: "LEASED",
  label: "借出",
  local_label: "借出",
  full_label: "借出",
  path: "借出",
  search_text: "借出",
  kind: "system",
  parent: "SYSTEM",
  lft: 17,
  rgt: 18,
  is_group: false,
  protected: true,
  can_edit: false,
});
const damaged = node({
  name: "DAMAGED",
  label: "损坏待处理",
  local_label: "损坏待处理",
  full_label: "损坏待处理",
  path: "损坏待处理",
  search_text: "损坏待处理",
  kind: "system",
  parent: "SYSTEM",
  lft: 19,
  rgt: 20,
  is_group: false,
  protected: true,
  can_edit: false,
});
const tree = {
  rows: [node({}), area, room, direct, shelf, systemRoot, leased, damaged],
  physical_root: "ROOT",
  company: "TEMPLE",
  can_create: true,
};
function setup(
  call = vi.fn(async (endpoint: string) =>
    endpoint === "configuration.status" ? { needs_first_room: false } : tree,
  ),
  pageProps: Record<string, unknown> = {},
  report = vi.fn(async (query: ReportQuery) => ({
    query,
    table: query.view,
    rows: [],
    columns: [],
    matched_count: 0,
    next_start: null,
    snapshot: "now",
    summary: [],
    period: { date_from: "", date_to: "" },
    tables: [],
  })),
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "site",
    user: "manager",
    physicalLeaves: ["ROOM-DIRECT", "SHELF"],
    capabilities: { "Stock Reconciliation": { create: true } },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report, upload: vi.fn() } as never,
          reference,
        );
        return () => h(NativeWarehousesPage, pageProps);
      },
    }),
  );
  wrappers.push(wrapper);
  return {
    wrapper,
    c: wrapper.findComponent(NativeWarehousesPage).vm.controller,
    call,
    reference,
  };
}
describe("native location workspace", () => {
  it("exports a selected warehouse stock table using its page column order", async () => {
    const { wrapper } = setup(undefined, { initialWarehouse: "SHELF" });
    await flushPromises();
    const quickExport = wrapper.getComponent(QuickExport);
    expect(quickExport.props()).toMatchObject({ table: "locations" });
    expect(quickExport.props("title")).toContain("库房清单 ·");
    expect(quickExport.props("columns")).toEqual([
      "item_name",
      "item_code",
      "warehouse_label",
      "batch_no",
      "stock_qty",
      "stock_uom",
    ]);
    expect(quickExport.props("columns")).not.toContain("image_file");
    await quickExport.get("button.quick-report").trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("物品图片");
  });
  it("reads the presenter labels and hides direct-storage leaves from the selectable tree", async () => {
    const { c } = setup();
    await flushPromises();
    expect(c.visibleRows.value.map((row) => row.name)).toEqual([
      "ROOT",
      "AREA",
      "ROOM",
      "SHELF",
      "SYSTEM",
      "LEASED",
      "DAMAGED",
    ]);
    expect(c.visibleRows.value[0]?.depth).toBe(0);
    expect(
      c.visibleRows.value.find((row) => row.name === "ROOT")?.is_group,
    ).toBe(true);
    expect(c.selected.value?.name).toBe("ROOT");
    expect(
      c.visibleRows.value.find((row) => row.name === "ROOM")?.local_label,
    ).toBe("演示室甲");
    expect(warehouseLabel("ROOM-DIRECT", tree.rows)).toBe("A02");
    expect(warehousePath("ROOM-DIRECT", tree.rows)).toBe("T2 / A02");
  });
  it("creates a location through the versioned location API shape", async () => {
    const call = vi.fn(async (endpoint: string) =>
      endpoint === "configuration.status" ? { needs_first_room: false } : tree,
    );
    const { c } = setup(call);
    await flushPromises();
    c.openEditor(undefined, "create", "shelf");
    c.form.label = "新货位";
    c.form.parent = "ROOM";
    await c.save();
    await flushPromises();
    expect(call).toHaveBeenCalledWith("warehouses.create_location", {
      kind: "Shelf",
      label: "新货位",
      short_label: "",
      parent: "ROOM",
    });
  });
  it("renames with the presenter version and exposes contextual actions", async () => {
    const call = vi.fn(async (endpoint: string) =>
      endpoint === "configuration.status" ? { needs_first_room: false } : tree,
    );
    const { c } = setup(call);
    await flushPromises();
    c.openEditor(room, "rename");
    c.form.label = "改名房间";
    c.form.short_label = "A02";
    await c.save();
    await flushPromises();
    expect(call).toHaveBeenCalledWith("warehouses.rename_location", {
      name: "ROOM",
      label: "改名房间",
      short_label: "A02",
      version: "room-v4",
    });
    await c.subdivide(shelf);
    expect(call).toHaveBeenCalledWith("warehouses.subdivide_shelf", {
      name: "SHELF",
      version: "v1",
    });
  });

  it("loads metadata before querying an exact warehouse scope and retains full unit totals", async () => {
    const report = vi.fn(async (query: ReportQuery) => ({
      query,
      table: query.view,
      rows: [],
      columns: [],
      matched_count: 205,
      next_start: null,
      snapshot: "now",
      summary: [
        { stock_uom: "Kg", stock_qty: 12.5 },
        { stock_uom: "Nos", stock_qty: 7626 },
      ],
      period: { date_from: "", date_to: "" },
      tables: [{ id: query.view, label: query.view, count: 205 }],
    }));
    const call = vi.fn(async (endpoint: string) =>
      endpoint === "configuration.status" ? { needs_first_room: false } : tree,
    );
    const { c } = setup(call, {}, report);
    await flushPromises();
    expect(call.mock.calls.map(([endpoint]) => endpoint).slice(0, 2)).toEqual([
      "warehouses.tree",
      "configuration.status",
    ]);
    expect(report.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({ warehouses: ["ROOT"] }),
      }),
    );
    expect(c.stock.result.summary).toEqual([
      { stock_uom: "Kg", stock_qty: 12.5 },
      { stock_uom: "Nos", stock_qty: 7626 },
    ]);
    expect(c.stock.result.total).toBe(205);
  });

  it("never substitutes a different warehouse or queries all stock for an unavailable deep link", async () => {
    const report = vi.fn();
    const { c, wrapper } = setup(
      vi.fn(async (endpoint: string) =>
        endpoint === "configuration.status"
          ? { needs_first_room: false }
          : tree,
      ),
      { name: "MISSING-DEEP-LOCATION" },
      report,
    );
    await flushPromises();
    expect(c.selected.value).toBeUndefined();
    expect(wrapper.text()).toContain("此位置不存在或当前账户无权读取");
    expect(report).not.toHaveBeenCalled();
    expect(c.stockQuery.value.scope.warehouses).toEqual([]);
  });

  it("keeps Room meaning separate from group structure and protects system nodes", async () => {
    const { c } = setup();
    await flushPromises();
    expect(room.kind).toBe("room");
    expect(room.is_group).toBe(true);
    expect(node({}).kind).toBe("system");
    expect(node({}).protected).toBe(true);
    expect(node({}).can_edit).toBe(false);
    expect(c.visibleRows.value.map((row) => row.name)).toContain("SYSTEM");
    expect(c.visibleRows.value.map((row) => row.name)).toContain("LEASED");
  });

  it("shows delete only for editable locations and confirms before deleting", async () => {
    const call = vi.fn(async (endpoint: string) =>
      endpoint === "configuration.status" ? { needs_first_room: false } : tree,
    );
    const { c, wrapper } = setup(call);
    await flushPromises();
    c.select("SHELF");
    await flushPromises();
    await wrapper.get('[aria-label="更多位置操作"]').trigger("click");
    await flushPromises();
    expect(
      document.querySelector('[role="menu"][aria-label="更多位置操作"]')
        ?.textContent,
    ).toContain("删除");
    c.select("ROOT");
    await flushPromises();
    expect(wrapper.find(".warehouse-action-menu").exists()).toBe(false);
    c.select("SHELF");
    await flushPromises();
    const deleting = c.deleteLocation(shelf);
    await flushPromises();
    expect(useConfirm().state.pending?.options).toMatchObject({
      title: "删除位置「演示架1」？",
      message: "此操作不能撤销。仅未使用的位置可以删除。",
      tone: "danger",
    });
    resolveConfirm(true);
    await deleting;
    expect(call).toHaveBeenCalledWith("warehouses.delete_location", {
      name: "SHELF",
      version: "v1",
    });
    expect(c.selectedName.value).toBe("ROOM");
  });

  it("shows a server deletion error in the danger callout", async () => {
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === "configuration.status")
        return { needs_first_room: false };
      if (endpoint === "warehouses.delete_location")
        throw new Error("已有库存或记录引用此位置");
      return tree;
    });
    const { c, wrapper } = setup(call);
    await flushPromises();
    const deleting = c.deleteLocation(shelf);
    await flushPromises();
    resolveConfirm(true);
    await deleting;
    expect(c.deleteError.value).toBe("已有库存或记录引用此位置");
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "已有库存或记录引用此位置",
    );
  });

  it("retains edits made during a native metadata save with the new native base version", async () => {
    let resolveRename!: () => void;
    let treeReads = 0;
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === "configuration.status")
        return { needs_first_room: false };
      if (endpoint === "warehouses.rename_location")
        return new Promise<void>((resolve) => (resolveRename = resolve));
      treeReads++;
      return treeReads > 1
        ? {
            ...tree,
            rows: tree.rows.map((row) =>
              row.name === "ROOM"
                ? {
                    ...row,
                    label: "改名房间",
                    full_label: "改名房间",
                    version: "room-v5",
                  }
                : row,
            ),
          }
        : tree;
    });
    const { c } = setup(call);
    await flushPromises();
    c.openEditor(room, "rename");
    c.form.label = "改名房间";
    const saving = c.save();
    await flushPromises();
    c.form.short_label = "A02 后改";
    resolveRename();
    await saving;
    await flushPromises();
    expect(c.dialogOpen.value).toBe(true);
    expect(c.form.short_label).toBe("A02 后改");
    const snapshots = Object.keys(localStorage)
      .filter((key) => key.includes("temple-inventory:recovery:v1"))
      .map((key) => JSON.parse(localStorage.getItem(key) || "{}"));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].baseVersion).toBe("room-v5");
  });

  it("rejects recovery over a changed native warehouse and clears old-account metadata", async () => {
    const { c, reference } = setup();
    await flushPromises();
    c.openEditor(room, "rename");
    c.form.label = "本地未完成修改";
    await flushPromises();
    const entry = JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((key) => key.includes("recovery:v1")) ||
          "",
      ) || "{}",
    );
    entry.baseVersion = "stale-version";
    await c.recover(entry);
    expect(c.dialogOpen.value).toBe(true);
    expect(c.recoveryError.value).toContain("原位置已更改");
    reference.user = "another-account";
    await flushPromises();
    expect(c.tree.value).toBeUndefined();
  });

  it("renders the gallery warehouse tree with the shared controller and fixture service", async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          provideGalleryReference();
          return () => h(NativeWarehousesPage);
        },
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain("位置结构");
    expect(wrapper.findAll(".browse-tree-row").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("实体库房");
    expect(fixtureServices).toBeTruthy();
  });

  it("uses DataTable columns with centered artwork, nowrap codes, and end-aligned quantities", async () => {
    const report = vi.fn(async (query: ReportQuery) => ({
      query,
      table: "locations",
      rows: [
        {
          id: "item-1",
          item_code: "ITM-000123",
          item_name: "测试物品",
          image: "/test.webp",
          warehouse: "SHELF",
          warehouse_label: "演示架1",
          warehouse_path: "T2 / A02 / 演示架1",
          batch_no: "BATCH-1",
          stock_qty: 12,
          stock_uom: "Nos",
        },
      ],
      matched_count: 1,
      next_start: null,
      snapshot: "now",
      summary: [],
      period: { date_from: "", date_to: "" },
      tables: [
        {
          id: "locations",
          label: "位置",
          count: 1,
          columns: [
            "item_code",
            "item_name",
            "warehouse_label",
            "batch_no",
            "stock_qty",
          ],
        },
      ],
    }));
    const { wrapper } = setup(undefined, { initialWarehouse: "SHELF" }, report);
    await flushPromises();
    expect(wrapper.findComponent({ name: "BrowseToolbar" }).exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("节点");
    const table = wrapper.get(".warehouse-stock-table");
    expect(table.get("th.align-center").exists()).toBe(true);
    expect(table.get("th.align-end").exists()).toBe(true);
    expect(table.get('th button[aria-label^="物品名称排序"]').exists()).toBe(
      true,
    );
    expect(table.get('button[aria-label="设置列"]').exists()).toBe(true);
    expect(table.get("td.warehouse-code").classes()).toContain("align-start");
    expect(table.text()).toContain("ITM-000123");
    expect(table.text()).toContain("12 Nos");
    expect(table.find("[title='T2 / A02 / 演示架1']").exists()).toBe(true);
  });
});
