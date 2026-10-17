import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { useCountEditor } from "../src/features/counts/useCountEditor";
import { countSummary, type CountRow } from "../src/features/counts/countModel";
import NativeCountAllocations from "../src/features/counts/NativeCountAllocations.vue";
const wrappers: VueWrapper[] = [];
it("shows recorded multi-batch book, actual zero and variance without changing native data", () => {
  const row = {
    stock_uom: "袋",
    recorded_count_allocations: [
      { batch_no: "原生批次A", baseline_qty: 5, actual_qty: 3, difference: -2 },
      { batch_no: "原生批次B", baseline_qty: 5, actual_qty: 0, difference: -5 },
    ],
  };
  const wrapper = mount(NativeCountAllocations, { props: { row } });
  wrappers.push(wrapper);
  expect(wrapper.findAll("dt").map((value) => value.text())).toEqual([
    "原生批次A",
    "原生批次B",
  ]);
  expect(wrapper.findAll("dd")[1]?.text()).toBe("账面 5 · 实点 0 · 差异 -5 袋");
  expect(wrapper.findAll("input")).toHaveLength(0);
  expect(row.recorded_count_allocations[1]?.actual_qty).toBe(0);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});
function row(overrides: Partial<CountRow> = {}): CountRow {
  return {
    item_code: "ITEM-A",
    warehouse: "ROOM-A",
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: 10,
    actual_qty: null,
    review_state: "Unreviewed",
    reason: "",
    needs_review: true,
    ...overrides,
  };
}
function setup(
  call: ReturnType<typeof vi.fn>,
  props: Parameters<typeof useCountEditor>[0] = { warehouse: "ROOM-A" },
) {
  let c!: ReturnType<typeof useCountEditor>;
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "unit-site",
    user: "volunteer",
    company: "TEMPLE",
    siteDate: "2026-10-16",
    siteTime: "2026-10-16 10:00:00",
    physicalLeaves: ["ROOM-A", "ROOM-B"],
    units: [{ name: "Nos", whole: true }],
    capabilities: { "Stock Reconciliation": { create: true, submit: true } },
  });
  const child = defineComponent({
    setup() {
      c = useCountEditor(props);
      return () => h("div");
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  wrappers.push(mount(root));
  return { c, reference };
}
function service() {
  let saved: Record<string, unknown>;
  return vi.fn(async (method: string, args: Record<string, any>) => {
    if (method === "counts.count_baseline")
      return {
        rows: [row()],
        timestamp: args.timestamp,
        fingerprint: "BASE-1",
        removed_rows: [],
      };
    if (method === "catalog.operation_item")
      return { item_code: "ITEM-A", item_name: "测试物品" };
    if (method === "native_files.attachments") return [];
    if (method === "counts.save_count") {
      const rows = args.data.ti_count_review as CountRow[];
      if (
        rows.every(
          (row) =>
            row.review_state === "Unreviewed" ||
            row.actual_qty === row.baseline_qty,
        )
      )
        return { no_adjustment: true, existing_draft: args.name };
      saved = {
        ...args.data,
        doctype: "Stock Reconciliation",
        name: "COUNT-1",
        version: "v1",
        docstatus: 0,
        purpose: "Stock Reconciliation",
        editable: true,
        items: rows
          .filter(
            (row) =>
              row.review_state !== "Unreviewed" &&
              row.actual_qty !== row.baseline_qty,
          )
          .map((row) => ({
            name: "COUNT-ROW",
            item_code: row.item_code,
            warehouse: row.warehouse,
            qty: row.actual_qty,
          })),
      };
      return saved;
    }
    if (method === "native_api.submit_document")
      return { ...saved, version: "v2", docstatus: 1, editable: false };
    throw new Error(`Unexpected ${method}`);
  });
}
describe("native count form integration", () => {
  it("keeps blanks unreviewed, separates zero and not-found, and totals stock units independently", async () => {
    const { c } = setup(service());
    await flushPromises();
    expect(c.summary.value.reviewed).toBe(0);
    expect(c.valid.value).toBe(false);
    c.input(c.rows.value[0]!, "0");
    expect(c.rows.value[0]?.review_state).toBe("Reviewed");
    expect(c.issues.value[0]?.message).toContain("原因");
    c.notFound(c.rows.value[0]!);
    expect(c.rows.value[0]).toMatchObject({
      actual_qty: 0,
      review_state: "Not Found",
      reason: "未找到",
    });
    c.input(c.rows.value[0]!, "");
    expect(c.rows.value[0]?.actual_qty).toBeNull();
    expect(c.summary.value.reviewed).toBe(0);
    const totals = countSummary([
      row({ actual_qty: 0, review_state: "Reviewed" }),
      row({
        item_code: "ITEM-B",
        stock_uom: "Kg",
        baseline_qty: 2.5,
        actual_qty: 3,
        review_state: "Reviewed",
      }),
    ]);
    expect(totals.baseline).toEqual([
      ["Nos", 10],
      ["Kg", 2.5],
    ]);
    expect(totals.difference).toEqual([
      ["Nos", -10],
      ["Kg", 0.5],
    ]);
  });
  it("finishes matching counts without creating or submitting any native document and clears only on explicit finish", async () => {
    const call = service(),
      { c } = setup(call);
    await flushPromises();
    c.input(c.rows.value[0]!, "10");
    await c.confirm();
    expect(c.state.status).toBe("matching");
    expect(c.state.identity).toBeUndefined();
    expect(
      call.mock.calls.some(
        ([method]) =>
          method === "native_api.submit_document" ||
          method === "native_api.create_document",
      ),
    ).toBe(false);
    expect(c.recovery.list().entries).toHaveLength(1);
    expect(c.finished.value).toBe(false);
    c.finishMatching();
    expect(c.finished.value).toBe(true);
    expect(c.recovery.list().entries).toHaveLength(0);
  });
  it("submits only reviewed differences and leaves other full-location rows unreviewed", async () => {
    const call = service(),
      { c } = setup(call);
    await flushPromises();
    c.values.value.ti_count_review.push(row({ item_code: "ITEM-B" }));
    c.input(c.rows.value[0]!, "8");
    c.rows.value[0]!.reason = "破损";
    expect(c.valid.value).toBe(true);
    await c.confirm();
    expect(c.state.status).toBe("submitted");
    expect(c.state.server?.items).toHaveLength(1);
    expect(c.state.server?.items[0]?.qty).toBe(8);
    expect(c.summary.value.unreviewed).toBe(1);
  });
  it("requires a new baseline after location, selection, scope or timestamp changes", async () => {
    const call = service(),
      { c } = setup(call);
    await flushPromises();
    c.input(c.rows.value[0]!, "10");
    expect(c.valid.value).toBe(true);
    c.values.value.ti_count_warehouse = "ROOM-B";
    expect(c.currentBaseline.value).toBe(false);
    await c.save();
    expect(
      call.mock.calls.some(([method]) => method === "counts.save_count"),
    ).toBe(false);
    c.values.value.ti_count_warehouse = "ROOM-A";
    expect(c.currentBaseline.value).toBe(true);
    c.values.value.ti_count_scope = "Selected";
    expect(c.currentBaseline.value).toBe(false);
    c.values.value.ti_count_scope = "Full Location";
    c.values.value.posting_time = "11:00:00";
    expect(c.currentBaseline.value).toBe(false);
  });
  it("retains changed and removed baseline inputs and requires explicit re-review", async () => {
    const call = service(),
      { c } = setup(call);
    await flushPromises();
    c.input(c.rows.value[0]!, "8");
    c.rows.value[0]!.reason = "核对";
    const previous = structuredClone(
      JSON.parse(JSON.stringify(c.rows.value[0]!)),
    );
    const base = call.getMockImplementation()!;
    call.mockImplementation(async (method, args) =>
      method === "counts.count_baseline"
        ? {
            rows: [
              row({
                baseline_qty: 12,
                actual_qty: 8,
                review_state: "Unreviewed",
                reason: "核对",
                needs_review: true,
              }),
              row({ item_code: "ITEM-B", needs_review: true }),
            ],
            fingerprint: "BASE-2",
            timestamp: args.timestamp,
            removed_rows: [
              { ...previous, item_code: "REMOVED", actual_qty: 4 },
            ],
          }
        : base(method, args),
    );
    await c.refresh();
    expect(c.rows.value[0]?.actual_qty).toBe(8);
    expect(c.valid.value).toBe(false);
    expect(c.removed.value[0]?.actual_qty).toBe(4);
    c.rereview(c.rows.value[0]!);
    c.removalAcknowledged.value = true;
    expect(c.valid.value).toBe(true);
    expect(c.rows.value[1]?.review_state).toBe("Unreviewed");
  });
  it("preserves native Desk count rows without inventing full-location review metadata", async () => {
    const base = service();
    const call = vi.fn(async (method, args) =>
      method === "native_api.load_document"
        ? {
            doctype: "Stock Reconciliation",
            name: "DESK-COUNT",
            version: "v1",
            docstatus: 0,
            purpose: "Stock Reconciliation",
            editable: true,
            ti_count_items: "[]",
            posting_date: "2026-10-16",
            posting_time: "10:00:00",
            items: [
              {
                name: "NATIVE-ROW",
                item_code: "ITEM-A",
                warehouse: "ROOM-A",
                qty: 4,
                current_qty: 10,
                stock_uom: "Nos",
              },
            ],
          }
        : base(method, args),
    );
    const { c } = setup(call, { name: "DESK-COUNT" });
    await flushPromises();
    expect(c.deskOrigin.value).toBe(true);
    expect(c.rows.value).toEqual([]);
    expect(c.values.value.items[0]?.name).toBe("NATIVE-ROW");
    expect(c.valid.value).toBe(true);
    expect(
      call.mock.calls.some(([method]) => method === "counts.count_baseline"),
    ).toBe(false);
  });
});

it("keeps difference drafts editable without submit permission while matching counts may finish locally", async () => {
  const call = service(),
    { c, reference } = setup(call);
  await flushPromises();
  reference.capabilities["Stock Reconciliation"]!.submit = false;
  c.input(c.rows.value[0]!, "8");
  c.rows.value[0]!.reason = "实点";
  await c.confirm();
  expect(c.state.status).toBe("saved");
  expect(c.writable.value).toBe(true);
  expect(
    call.mock.calls.some(([method]) => method === "native_api.submit_document"),
  ).toBe(false);
  const { c: matching, reference: matchingReference } = setup(service());
  await flushPromises();
  matchingReference.capabilities["Stock Reconciliation"]!.submit = false;
  matching.input(matching.rows.value[0]!, "10");
  await matching.confirm();
  expect(matching.state.status).toBe("matching");
  matching.finishMatching();
  expect(matching.finished.value).toBe(true);
});
