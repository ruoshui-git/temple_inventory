import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import Overlay from "../src/components/ui/Overlay.vue";
import ImageCrop from "../src/components/ui/ImageCrop.vue";
import ReportTable from "../src/components/ui/ReportTable.vue";
import { warehouseLabel } from "../src/lib/warehouseLabel";
import { reportFilterChips } from "../src/lib/reportFilters";
import { newReportQuery } from "../src/lib/reportContract";
import { useRelatedLoans } from "../src/features/loans/useRelatedLoans";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
const wrappers: VueWrapper[] = [];
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
it("distinguishes loading, initial failure, successful empty and retained refresh", async () => {
  const wrapper = render(ReportTable, { table, loading: true });
  expect(wrapper.text()).toContain("正在读取");
  expect(wrapper.text()).not.toContain("没有符合");
  await wrapper.setProps({ loading: false, error: "failed" });
  expect(wrapper.text()).not.toContain("没有符合");
  await wrapper.setProps({ error: "" });
  expect(wrapper.text()).toContain("没有符合");
  await wrapper.setProps({
    table: { ...table, rows: [{ docstatus: 1 }] },
    loading: true,
  });
  expect(wrapper.text()).toContain("已提交");
  expect(wrapper.text()).toContain("保留上次结果");
});
it("resolves duplicate and hyphenated authorized warehouse labels without changing keys", () => {
  const nodes = [
    { name: "ROOM-A - COMPANY", label: "东-库房" },
    { name: "P1", label: "一楼" },
    { name: "P2", label: "二楼" },
    { name: "L1", label: "A-01", parent: "P1" },
    { name: "L2", label: "A-01", parent: "P2" },
  ];
  expect(warehouseLabel("ROOM-A - COMPANY", nodes)).toBe("东-库房");
  expect(warehouseLabel("L2", nodes)).toBe("二楼 / A-01");
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
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1200, height: 800, close: vi.fn() }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["crop"], { type: "image/png" })),
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
      click("使用裁剪图片");
      await flushPromises();
      const files = wrapper.emitted("choose")![0]![0] as File[];
      expect(files.map((file) => file.name)).toEqual(
        retain ? ["photo-裁剪.png", "原图-photo.jpg"] : ["photo-裁剪.png"],
      );
      expect(files[0]!.type).toBe("image/png");
    },
  );
  it("uses the original alone or cancels without finalizing any file", async () => {
    const { wrapper, original } = await crop();
    click("使用原图");
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
