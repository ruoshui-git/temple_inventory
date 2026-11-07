// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/lib/api", () => ({ request }));
vi.mock("../src/services/contracts", () => ({
  useReferenceData: () => ({ capabilities: { imports: { create: true } } }),
}));
import {
  itemImportColumns,
  actionLabels,
} from "../src/features/imports/itemConfig";
import { useImportWizard } from "../src/features/imports/useImportWizard";
import { routeRegistry, routeTarget } from "../src/lib/routeRegistry";
import { filterNavigation, moreNavigation } from "../src/lib/appNavigation";
import { routeAllowed } from "../src/lib/capabilities";

describe("Item import feature definition and gating", () => {
  beforeEach(() => request.mockReset());
  it("pins the column contract and Chinese action labels", () => {
    expect(itemImportColumns.map((column) => column.label)).toEqual([
      "物品编号",
      "导入参考号",
      "物品名称",
      "类别",
      "库存单位",
      "说明",
      "条码",
      "追踪方式",
      "记录效期",
      "编号规则",
    ]);
    expect(actionLabels).toEqual({
      NEW: "新建",
      UPDATE: "更新",
      UNCHANGED: "无变化",
      REJECTED: "无法导入",
    });
  });
  it("requires imports.create on the canonical route and More entry", () => {
    const entry = routeRegistry.find((route) => route.name === "imports");
    expect(entry).toMatchObject({
      path: "/imports/items",
      requires: "imports.create",
    });
    expect(routeTarget("imports").name).toBe("imports");
    expect(
      moreNavigation
        .flatMap((group) => group.items)
        .find((item) => item.key === "item-import")?.requires,
    ).toBe("imports.create");
    expect(
      routeAllowed("imports.create", { imports: { create: false } } as never),
    ).toBe(false);
    expect(
      filterNavigation([{ requires: "imports.create" }], {
        imports: { create: false },
      } as never),
    ).toEqual([]);
  });
  it("uploads with multipart and keeps the preview read-only until explicit commit", async () => {
    const preview = {
      name: "IMPORT-1",
      status: "Previewed",
      counts: { new: 1, update: 0, unchanged: 0, rejected: 0 },
      rows: [],
      plan_hash: "hash",
      error: "",
    };
    request.mockResolvedValue(preview);
    let controller!: ReturnType<typeof useImportWizard>;
    const wrapper = mount(
      defineComponent({
        setup() {
          controller = useImportWizard();
          return () => h("div");
        },
      }),
    );
    controller.file.value = new File(["workbook"], "items.xlsx");
    await controller.upload();
    expect(request).toHaveBeenCalledWith(
      "temple_inventory.imports.upload",
      {},
      expect.any(FormData),
    );
    expect(controller.preview.value).toEqual(preview);
    expect(controller.step.value).toBe("preview");
    expect(request).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
