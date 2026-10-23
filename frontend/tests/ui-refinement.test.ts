import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import Overlay from "../src/components/ui/Overlay.vue";
import DashboardSection from "../src/components/DashboardSection.vue";
import DocumentLoadingState from "../src/components/ui/DocumentLoadingState.vue";
import ImageCrop from "../src/components/ui/ImageCrop.vue";
import RecoverySummary from "../src/components/ui/RecoverySummary.vue";
import ReportTable from "../src/components/ui/ReportTable.vue";
import { warehouseLabel } from "../src/lib/warehouseLabel";
import { hasReportStatuses, reportFilterChips } from "../src/lib/reportFilters";
import { newReportQuery } from "../src/lib/reportContract";
import { useRelatedLoans } from "../src/features/loans/useRelatedLoans";
import {
  createReferenceData,
  provideInventoryServices,
  type LocationNode,
} from "../src/services/contracts";
const cropperMocks = vi.hoisted(() => {
  const selection = {
    width: 1000,
    height: 1000,
    aspectRatio: Number.NaN,
    initialAspectRatio: Number.NaN,
    keyboard: false,
    $reset: vi.fn(),
    $toCanvas: vi.fn(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 1000;
      return canvas;
    }),
  };
  const image = {
    $ready: vi.fn(async () => new Image()),
    $center: vi.fn(),
    $zoom: vi.fn(),
    $getTransform: vi.fn(() => [1, 0, 0, 1, 0, 0]),
    $image: { naturalWidth: 1600, naturalHeight: 1200 },
  };
  return {
    selection,
    image,
    createCropper: vi.fn(() => ({
      getCropperImage: () => image,
      getCropperSelection: () => selection,
      getCropperCanvas: () => ({}),
      destroy: vi.fn(),
    })),
  };
});
vi.mock("cropperjs", () => ({ createCropper: cropperMocks.createCropper }));
const wrappers: VueWrapper[] = [];
it("renders accessible skeleton cards while an existing native document loads", () => {
  const wrapper = mount(DocumentLoadingState, {
    props: { label: "正在读取库存单据…" },
  });
  wrappers.push(wrapper);
  expect(wrapper.get('[role="status"]').attributes("aria-busy")).toBe("true");
  expect(wrapper.get(".visually-hidden").text()).toBe("正在读取库存单据…");
  expect(wrapper.findAll(".document-loading-card")).toHaveLength(2);
  expect(wrapper.findAll(".document-loading-card i").length).toBeGreaterThan(4);
  const editorSkeleton = mount(DocumentLoadingState, {
    props: { label: "正在读取库存单据…", announce: false },
  });
  wrappers.push(editorSkeleton);
  expect(editorSkeleton.find('[role="status"]').exists()).toBe(false);
});
it("normalizes sanitized local operation rows for recovery display", () => {
  const wrapper = mount(RecoverySummary, {
    props: {
      kind: "Stock Entry",
      values: {
        kind: "Receive",
        items: [
          {
            item_name: "本地新物品",
            code: "ITEM-LOCAL",
            name: "native-child-row-id",
            entryQty: 2,
            entryUom: "Box",
            qty: 24,
            uom: "Nos",
            location: "ROOM-A",
            batch: "BATCH-A",
          },
        ],
      },
      copyText: "{}",
    },
  });
  wrappers.push(wrapper);
  expect(wrapper.text()).toContain("ITEM-LOCAL");
  expect(wrapper.text()).toContain("本地新物品");
  expect(wrapper.text()).toContain("24");
  expect(wrapper.text()).toContain("Nos");
  expect(wrapper.text()).toContain("ROOM-A");
  expect(wrapper.text()).toContain("BATCH-A");
});
it("keeps dashboard card structure stable while refreshing retained results", async () => {
  const wrapper = mount(DashboardSection, {
    props: {
      title: "库存分布",
      snapshot: "snapshot-1",
      section: { status: "ready", hasResult: true },
    },
    slots: {
      heading: () => h("div", { class: "browse-card-heading" }, "库存分布"),
      default: () => h("div", { class: "distribution-result" }, "已载入结果"),
    },
  });
  wrappers.push(wrapper);
  const cardShape = Array.from(wrapper.get("article").element.children).map(
    (element) => element.tagName,
  );

  await wrapper.setProps({
    section: { status: "loading", hasResult: true },
  });

  expect(
    Array.from(wrapper.get("article").element.children).map(
      (element) => element.tagName,
    ),
  ).toEqual(cardShape);
  expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
  expect(wrapper.get(".dashboard-refresh-status").text()).toBe("更新中…");
  expect(wrapper.get('.async-result-region [role="status"]').text()).toBe(
    "库存分布数据刷新中…",
  );
  expect(wrapper.find(".dashboard-stale-label").exists()).toBe(false);
  expect(wrapper.get(".async-result-region").classes()).toContain(
    "is-refreshing",
  );
});
it("formats allocation chips with authorized warehouse labels while preserving exact query identities", () => {
  const reference = createReferenceData();
  reference.warehouses = [{ name: "东/库 - O", label: "东/库" }];
  const query = newReportQuery("expiry");
  query.allocationKeys = [
    JSON.stringify(["ITEM/1", "东/库 - O", "B1"]),
    "ITEM/1/东/库 - O/B2",
  ];
  query.itemLocationKeys = [
    JSON.stringify(["ITEM/1", "东/库 - O"]),
    "ITEM/1/东/库 - O",
  ];
  const before = JSON.stringify(query);
  const chips = reportFilterChips(query, reference);
  expect(chips.find((chip) => chip.key === "allocations")?.label).toContain(
    "ITEM/1 / 东/库 / B1",
  );
  expect(chips.find((chip) => chip.key === "allocations")?.label).toContain(
    "ITEM/1 / 东/库 / B2",
  );
  expect(chips.find((chip) => chip.key === "itemLocations")?.label).toContain(
    "ITEM/1 / 东/库",
  );
  expect(JSON.stringify(chips)).not.toContain(" - O");
  expect(JSON.stringify(query)).toBe(before);
  reference.warehouses = [];
  expect(JSON.stringify(reportFilterChips(query, reference))).not.toContain(
    " - O",
  );
  const movement = newReportQuery("movements");
  movement.allocationKeys = [JSON.stringify(["Stock Entry", "MAT-1", "ROW-1"])];
  expect(
    reportFilterChips(movement, reference).find(
      (chip) => chip.key === "allocations",
    )?.label,
  ).toContain("Stock Entry / MAT-1 / ROW-1");
});
it("surfaces the settled loan-item population as a removable filter", () => {
  const query = newReportQuery("loans");
  query.view = "items";
  query.includeZero = true;
  expect(hasReportStatuses(query)).toBe(false);
  const chip = reportFilterChips(query, createReferenceData()).find(
    (row) => row.key === "includeZero",
  );
  expect(chip?.label).toBe("显示已结清物品");
  expect(chip?.reset.includeZero).toBe(false);
  query.view = "records";
  expect(
    reportFilterChips(query, createReferenceData()).some(
      (row) => row.key === "includeZero",
    ),
  ).toBe(false);
});
it("exposes exact batch scope in report filters with an explicit clear action", () => {
  const query = newReportQuery("movements");
  query.batchNo = "LOT-EXACT-42";
  const chip = reportFilterChips(query, createReferenceData()).find(
    (row) => row.key === "batchNo",
  );
  expect(chip?.label).toBe("批次：LOT-EXACT-42");
  expect(chip?.reset.batchNo).toBe("");
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(component: any, props: any = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
function click(text: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
  expect(button).toBeTruthy();
  button!.focus();
  button!.click();
}
const table = { id: "t", label: "记录", columns: ["docstatus"], rows: [] };
it("keeps generic action slots while a table without a slot has no action column", () => {
  const data = {
    ...table,
    columns: ["document"],
    rows: [{ id: "A", document: "A" }],
  };
  const plain = render(ReportTable, { table: data });
  expect(plain.findAll("th")).toHaveLength(1);
  const WithActions = defineComponent({
    setup() {
      return () =>
        h(ReportTable, { table: data }, { actions: () => h("button", "Act") });
    },
  });
  const actions = render(WithActions);
  expect(actions.findAll("th")).toHaveLength(2);
  expect(actions.text()).toContain("Act");
});
it("distinguishes loading, initial failure, successful empty and retained refresh", async () => {
  const wrapper = render(ReportTable, {
    table,
    loading: true,
    initialized: false,
  });
  expect(wrapper.find(".data-table-skeleton-row").exists()).toBe(true);
  expect(wrapper.text()).not.toContain("没有符合");
  await wrapper.setProps({
    loading: false,
    initialized: true,
    error: "failed",
  });
  expect(wrapper.text()).not.toContain("没有符合");
  await wrapper.setProps({ error: "" });
  expect(wrapper.text()).toContain("没有符合");
  await wrapper.setProps({
    table: { ...table, rows: [{ docstatus: 1 }] },
    loading: true,
    stale: true,
  });
  expect(wrapper.text()).toContain("已提交");
  expect(wrapper.text()).toContain("保留当前结果");
});
it("uses presenter labels and keeps authorized warehouse keys unchanged", () => {
  const node = (name: string, label: string, path: string): LocationNode => ({
    name,
    label,
    local_label: label,
    short_label: "",
    full_label: label,
    path,
    search_text: `${path} ${label}`,
    kind: "shelf",
    owner: "",
    direct: false,
    storable: true,
    missing_direct: false,
    parent: "",
    is_group: false,
    disabled: false,
    lft: 1,
    rgt: 2,
    version: "",
    protected: false,
    can_edit: true,
  });
  const nodes = [
    node("ROOM-A - COMPANY", "东-库房", "东院 / 东-库房"),
    node("L2", "A-01", "二楼 / A-01"),
  ];
  expect(warehouseLabel("ROOM-A - COMPANY", nodes)).toBe("东-库房");
  expect(warehouseLabel("L2", nodes)).toBe("A-01");
  expect(warehouseLabel("SECRET", nodes)).toBe("位置暂不可用");
  expect(nodes[0]!.name).toBe("ROOM-A - COMPANY");
});
it("stages a child overlay inside the same dialog and restores its trigger", async () => {
  const child = ref(false);
  const wrapper = render(
    defineComponent({
      setup() {
        return () =>
          h(
            Overlay,
            { title: "编辑器" },
            {
              default: () => [
                h("button", { onClick: () => (child.value = true) }, "裁剪"),
                child.value
                  ? h(
                      Overlay,
                      { title: "图片", onClose: () => (child.value = false) },
                      () => h("input"),
                    )
                  : null,
              ],
            },
          );
      },
    }),
  );
  await flushPromises();
  (document.querySelector("button") as HTMLElement).focus();
  click("裁剪");
  await flushPromises();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(
    document.querySelector('[role="dialog"]')!.getAttribute("aria-labelledby"),
  ).toBe(document.querySelector(".overlay-stage h2")!.id);
  document
    .querySelector(".preview-dialog")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  await flushPromises();
  expect(document.querySelector(".overlay-stage")).toBeNull();
  expect(document.activeElement?.textContent).toBe("裁剪");
});
describe("square crop choices", () => {
  async function crop() {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:crop-test");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["crop"], { type: "image/webp" })),
    );
    const original = new File(["original"], "photo.jpg", {
      type: "image/jpeg",
    });
    const wrapper = render(ImageCrop, { file: original });
    await flushPromises();
    return { wrapper, original };
  }
  it.each([false, true])(
    "retains an original only when explicitly selected (%s)",
    async (retain) => {
      const { wrapper } = await crop();
      const checkbox = document.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      )!;
      expect(checkbox.checked).toBe(false);
      checkbox.checked = retain;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      click("使用 WebP 裁剪图");
      await flushPromises();
      const files = wrapper.emitted("choose")![0]![0] as File[];
      expect(files.map((file) => file.name)).toEqual(
        retain ? ["photo-裁剪.webp", "原图-photo.jpg"] : ["photo-裁剪.webp"],
      );
      expect(files[0]!.type).toBe("image/webp");
    },
  );
  it("keeps crop output at native source resolution when the selected source is small", async () => {
    cropperMocks.image.$image.naturalWidth = 300;
    cropperMocks.image.$image.naturalHeight = 260;
    cropperMocks.selection.width = 900;
    cropperMocks.selection.height = 900;
    const { wrapper } = await crop();
    click("使用 WebP 裁剪图");
    await flushPromises();
    expect(cropperMocks.selection.$toCanvas).toHaveBeenLastCalledWith({
      width: 260,
      height: 260,
    });
    wrapper.unmount();
    cropperMocks.image.$image.naturalWidth = 1600;
    cropperMocks.image.$image.naturalHeight = 1200;
    cropperMocks.selection.width = 1000;
    cropperMocks.selection.height = 1000;
  });
  it("uses the original alone or cancels without finalizing any file", async () => {
    const { wrapper, original } = await crop();
    click("使用原图作为主图");
    await flushPromises();
    expect(wrapper.emitted("choose")![0]![0]).toEqual([original]);
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    const other = await crop();
    click("取消此图片");
    await flushPromises();
    expect(other.wrapper.emitted("choose")).toBeUndefined();
    expect(other.wrapper.emitted("cancel")).toHaveLength(1);
  });
});
it("discards late related-loan responses after close and guards account changes", async () => {
  let c!: ReturnType<typeof useRelatedLoans>,
    resolve!: (value: unknown) => void;
  const reference = createReferenceData();
  reference.user = "a";
  const call = vi.fn(() => new Promise((done) => (resolve = done)));
  const Child = defineComponent({
    setup() {
      c = useRelatedLoans();
      return () => h("div");
    },
  });
  render(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() } as any,
          reference,
        );
        return () => h(Child);
      },
    }),
  );
  c.show(["L1"]);
  c.close();
  resolve({ name: "L1", kind: "Loan" });
  await flushPromises();
  expect(c.records.L1?.loan).toBeUndefined();
  c.show(["L2"]);
  reference.user = "b";
  resolve({ name: "L2", kind: "Loan" });
  await flushPromises();
  expect(c.records.L2?.loan).toBeUndefined();
});
