// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import CountEditorView from "../src/features/counts/CountEditorView.vue";
import { useCountEditor } from "../src/features/counts/useCountEditor";
import type { CountRow } from "../src/features/counts/countModel";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

function countRow(
  itemCode: string,
  itemName: string,
  warehouse: string,
  baseline: number,
): CountRow {
  return {
    item_code: itemCode,
    item_name: itemName,
    image: "",
    warehouse,
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: baseline,
    actual_qty: null,
    review_state: "Unreviewed",
    reason: "",
    needs_review: false,
  };
}

function setup(mobile = false, submittedNative = false) {
  vi.stubGlobal("matchMedia", () => ({
    matches: !mobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const unreviewed = Array.from({ length: 174 }, (_, index) => {
    const code = `UNREVIEWED-${String(index).padStart(3, "0")}`;
    return countRow(code, code, index % 2 ? "ROOM-A" : "ROOM-B", 1);
  });
  const baselineRows = [
    ...unreviewed,
    countRow("CHECK-ZERO", "核对零数量", "ROOM-A", 5),
    countRow("CHECK-MATCH", "核对相同数量", "ROOM-B", 7),
    countRow("CHECK-DIFF", "核对差异数量", "ROOM-A", 2),
  ];
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    company: "TEMPLE",
    siteDate: "2026-10-19",
    siteTime: "2026-10-19 10:00:00",
    physicalLeaves: ["ROOM-A", "ROOM-B"],
    warehouses: [
      {
        name: "ROOM-A",
        label: "甲室",
        parent: "",
        is_group: false,
        lft: 1,
        rgt: 2,
      },
      {
        name: "ROOM-B",
        label: "乙室",
        parent: "",
        is_group: false,
        lft: 3,
        rgt: 4,
      },
    ],
    units: [{ name: "Nos", label: "个", whole: true }],
    capabilities: { "Stock Reconciliation": { create: true, submit: true } },
  });
  const call = vi.fn(async (method: string, args: Record<string, unknown>) => {
    if (method === "native_api.load_document" && submittedNative)
      return {
        doctype: "Stock Reconciliation",
        name: String(args.name),
        version: "v1",
        docstatus: 1,
        purpose: "Stock Reconciliation",
        editable: false,
        posting_date: "2026-10-19",
        posting_time: "10:00:00",
        items: [
          {
            name: "SUBMITTED-ROW",
            item_code: "SUBMITTED-ITEM",
            item_name: "已提交物品",
            warehouse: "ROOM-A",
            qty: 3,
            current_qty: 2,
            stock_uom: "Nos",
          },
        ],
      };
    if (method === "counts.count_baseline")
      return {
        rows: baselineRows,
        timestamp: args.timestamp,
        fingerprint: "BASE-177",
        removed_rows: [],
      };
    if (method === "catalog.item_summaries") return [];
    if (method === "native_files.attachments") return [];
    if (method === "browse.movement_history")
      return { rows: [], matched_count: 0, next_start: null };
    throw new Error(`Unexpected ${method}`);
  });
  let controller!: ReturnType<typeof useCountEditor>;
  const editor = defineComponent({
    setup() {
      controller = useCountEditor({
        name: submittedNative ? "SUBMITTED-COUNT" : undefined,
      });
      return () => h(CountEditorView, { controller });
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(editor);
    },
  });
  const wrapper = mount(root, { attachTo: document.body });
  wrappers.push(wrapper);
  return { wrapper, controller };
}

describe("count confirmation summary", () => {
  it("renders submitted native count differences in the read-only table on phones", async () => {
    const { wrapper } = setup(true, true);
    await flushPromises();
    expect(wrapper.findAll(".native-count-card")).toHaveLength(0);
    expect(wrapper.findAll(".native-count-card-input")).toHaveLength(0);
    expect(wrapper.find(".count-readonly").text()).toContain("已提交物品");
    expect(
      wrapper
        .find(
          ".count-readonly tbody tr[data-row-id]:not(.data-table-group-row) td:nth-child(5)",
        )
        .text(),
    ).toBe("3");
    expect(wrapper.find(".count-readonly").text()).toContain("+1 个");
  });

  it("opens count review with Meta+Enter from a text field without submitting", async () => {
    const { wrapper, controller } = setup();
    await flushPromises();
    vi.spyOn(controller, "review").mockImplementation(async () => {
      controller.reviewOpen.value = true;
    });
    const confirm = vi.spyOn(controller, "confirm");
    const input = wrapper.get(".count-search input").element;
    input.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(controller.review).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(controller.reviewOpen.value).toBe(true);
  });

  it("lists every reviewed row and excludes unreviewed rows regardless of workspace filters", async () => {
    const { wrapper, controller } = setup();
    await flushPromises();
    expect(controller.rows.value).toHaveLength(177);

    controller.input(controller.rows.value[174]!, "0");
    controller.input(controller.rows.value[175]!, "7");
    controller.input(controller.rows.value[176]!, "3");
    controller.values.value.ti_notes = "复核整批数量";
    vi.useFakeTimers();
    await wrapper.find(".count-search input").setValue("CHECK-DIFF");
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(wrapper.findAll("tbody tr[data-count-key]")).toHaveLength(1);
    vi.useRealTimers();

    controller.reviewOpen.value = true;
    await flushPromises();
    const dialog = document.body.querySelector<HTMLElement>(".ui-overlay");
    expect(dialog).not.toBeNull();
    const text = dialog!.textContent || "";
    expect(text).toContain("174 行未核对");
    expect(text).toContain(
      "未核对的行仍保留在本次范围中，但不会进入盘点调整。",
    );
    expect(text).toContain("盘点备注：复核整批数量");
    expect(text).toContain("核对零数量");
    expect(text).toContain("核对相同数量");
    expect(text).toContain("核对差异数量");
    expect(text).not.toContain("UNREVIEWED-000");
    expect(text).toContain("实点 0 个 · 差异 −5");
    expect(text).toContain("实点 7 个 · 差异 0");
    expect(text).toContain("实点 3 个 · 差异 +1");
    expect(
      dialog!.querySelectorAll(".count-confirmation-rows > p"),
    ).toHaveLength(3);
  });
});
