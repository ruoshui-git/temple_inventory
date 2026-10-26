// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import { useOperationEditor } from "../src/features/documents/useOperationEditor";
import {
  newOperation,
  decodeOperation,
  encodeOperation,
} from "../src/features/documents/operationCodec";
import type { NativeDocument } from "../src/features/documents/nativeEditor";
import { useAttachments } from "../src/features/attachments/useAttachments";
import AllocationSummary from "../src/features/documents/AllocationSummary.vue";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  vi.restoreAllMocks();
});
const item = {
  item_code: "ITEM-A",
  item_name: "物品甲",
  stock_uom: "Nos",
  item_group: "ROOT",
  version: "item-v1",
  can_edit: true,
  description: "",
  has_batch_no: false,
  has_expiry_date: false,
  barcodes: [],
  uoms: [{ uom: "Nos", conversion_factor: 1 }],
  stock: [{ warehouse: "ROOM-A", available: 20 }],
};
function setup<T>(
  factory: () => T,
  call = vi.fn(),
  upload = vi.fn(),
  render?: (controller: T) => ReturnType<typeof h>,
) {
  let controller!: T;
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "unit-site",
    user: "volunteer",
    company: "TEMPLE",
    siteDate: "2026-10-16",
    siteTime: "2026-10-16 10:00:00",
    physicalLeaves: ["ROOM-A", "ROOM-B"],
    leasedLeaves: ["LEASED"],
    damagedLeaves: ["DAMAGED"],
    units: [{ name: "Nos", whole: true }],
    capabilities: {
      "Stock Entry": { create: true, submit: true },
      Item: { create: true },
    },
  });
  const child = defineComponent({
    setup() {
      controller = factory();
      return () => (render ? render(controller) : h("div"));
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, upload, report: vi.fn() } as InventoryServices,
        reference,
      );
      return () => h(child);
    },
  });
  wrappers.push(mount(root));
  return { controller, reference, call, upload };
}
function document(
  data: Record<string, unknown>,
  version = "v1",
): NativeDocument {
  return {
    ...data,
    doctype: "Stock Entry",
    name: "STE-1",
    version,
    docstatus: 0,
    kind: data.ti_movement_kind || "Receive",
    editable: true,
    items: (data.items as Record<string, unknown>[]).map((line, index) => ({
      ...line,
      name: line.name || `CHILD-${index}`,
      transfer_qty: Number(line.qty) * Number(line.conversion_factor),
      stock_uom: "Nos",
    })),
  } as NativeDocument;
}
function service() {
  let saved: NativeDocument;
  return vi.fn(async (method, args) => {
    if (method === "catalog.operation_items")
      return { items: [structuredClone(item)], errors: [] };
    if (method === "catalog.batch_metadata_many") return {};
    if (method === "catalog.receipt_batches") return { batches: [] };
    if (method === "native_files.attachments") return [];
    if (method === "native_api.editor_clock")
      return { timestamp: "2026-10-16 11:22:33" };
    if (
      method === "native_api.create_document" ||
      method === "native_api.save_document"
    ) {
      saved = document(args.data, method.includes("create") ? "v1" : "v2");
      return structuredClone(saved);
    }
    if (method === "native_api.submit_document")
      return { ...saved!, version: "v3", docstatus: 1, editable: false };
    throw new Error(`Unexpected ${method}`);
  });
}
function addLine(c: ReturnType<typeof useOperationEditor>) {
  c.draft.value.items.push({
    id: "local-row",
    localId: "local-row",
    code: "ITEM-A",
    qty: 2,
    entryQty: 2,
    entryUom: "Nos",
    conversionFactor: 1,
    uom: "Nos",
    location: "ROOM-A",
  });
}
describe("native movement editor integration", () => {
  it("shows native saved item names immediately in read-only documents without sequential catalog loads", async () => {
    const original = {
      ...document({
        ti_movement_kind: "Issue",
        posting_date: "2026-10-16",
        posting_time: "12:00:00",
        items: [
          {
            item_code: "ITEM-A",
            item_name: "原记录物品名称",
            ti_display_item_name: "当前物品名称",
            ti_display_image: "/private/files/permitted-item.webp",
            ti_display_tracks_batch: true,
            batch_no: "BATCH-A",
            recorded_batch_allocations: [
              {
                name: "BATCH-LINE-A",
                batch_no: "BATCH-A",
                stock_qty: 2,
                expiry_date: "2027-10-16",
                manufacturing_date: "2026-01-16",
              },
            ],
            qty: 2,
            uom: "Nos",
            conversion_factor: 1,
            s_warehouse: "ROOM-A",
          },
        ],
      }),
      docstatus: 1,
      editable: false,
    } as NativeDocument;
    const call = vi.fn(async (method: string) => {
      if (method === "native_api.load_document") return original;
      if (method === "native_files.attachments") return [];
      throw new Error(`Unexpected ${method}`);
    });
    const { controller: c, reference } = setup(
      () =>
        useOperationEditor({
          identity: { doctype: "Stock Entry", name: "STE-1" },
        }),
      call,
      vi.fn(),
      (controller) => h(AllocationSummary, { draft: controller.draft.value }),
    );
    await flushPromises();

    expect(c.draft.value.items[0]).toMatchObject({
      displayName: "当前物品名称",
      displayImage: "/private/files/permitted-item.webp",
      expiry: "2027-10-16",
      manufacturingDate: "2026-01-16",
    });
    expect(wrappers.at(-1)?.text()).toContain("当前物品名称");
    expect(
      call.mock.calls.some(([method]) => method === "catalog.operation_items"),
    ).toBe(false);
    expect(
      call.mock.calls.some(
        ([method]) => method === "catalog.batch_metadata_many",
      ),
    ).toBe(false);
    const encoded = encodeOperation(c.draft.value, reference);
    expect(encoded.items[0]).not.toHaveProperty("displayName");
    expect(encoded.items[0]).not.toHaveProperty("displayImage");
    expect(encoded.items[0]).not.toHaveProperty("ti_display_item_name");
    expect(encoded.items[0]).not.toHaveProperty("ti_display_image");
  });

  it("duplicates a completed native record with stable retry identity and recorded factors without copying its files", async () => {
    const original = {
      ...document({
        ti_movement_kind: "Receive",
        posting_date: "2026-10-16",
        posting_time: "12:00:00",
        items: [
          {
            item_code: item.item_code,
            qty: 2,
            uom: "Box",
            conversion_factor: 5,
            t_warehouse: "ROOM-A",
          },
        ],
      }),
      docstatus: 1,
      editable: false,
    } as NativeDocument;
    const copied = {
      ...original,
      name: "STE-COPY",
      docstatus: 0,
      version: "copy-v1",
      editable: true,
      items: original.items.map((row) => ({ ...row, name: "COPY-ROW" })),
    } as NativeDocument;
    let attempts = 0;
    const call = vi.fn(async (method, args) => {
      if (method === "native_api.load_document") return original;
      if (method === "catalog.operation_items")
        return {
          items: [
            {
              ...item,
              can_edit: false,
              uoms: [
                { uom: "Nos", conversion_factor: 1 },
                { uom: "Box", conversion_factor: 8 },
              ],
            },
          ],
          errors: [],
        };
      if (method === "native_files.attachments")
        return args.name === "STE-1"
          ? [
              {
                name: "FILE-ORIGINAL",
                file_name: "receipt.pdf",
                file_url: "/private/files/receipt.pdf",
                file_type: "PDF",
              },
            ]
          : [];
      if (method === "native_api.duplicate_document") {
        if (++attempts === 1) throw new Error("连接中断，请重试");
        return copied;
      }
      throw new Error(`Unexpected ${method}`);
    });
    const { controller: c } = setup(
      () =>
        useOperationEditor({
          identity: { doctype: "Stock Entry", name: "STE-1" },
        }),
      call,
    );
    await flushPromises();
    expect(c.files.files).toHaveLength(1);
    c.action.value = "duplicate";
    await c.lifecycle();
    expect(c.state.identity?.name).toBe("STE-1");
    expect(c.state.error).toContain("连接中断");
    await c.lifecycle();
    expect(c.state.identity?.name).toBe("STE-COPY");
    expect(c.state.requestId).toBe(
      call.mock.calls.find(
        ([method]) => method === "native_api.duplicate_document",
      )![1].request_id,
    );
    expect(c.draft.value.items[0]?.conversionFactor).toBe(5);
    expect(c.draft.value.items[0]?.entryQty).toBe(2);
    expect(c.files.files).toHaveLength(0);
    const requests = call.mock.calls.filter(
      ([method]) => method === "native_api.duplicate_document",
    );
    expect(requests[0]![1].request_id).toBe(requests[1]![1].request_id);
    expect(
      call.mock.calls.some(
        ([method]) => method === "conversions.save_item_conversions",
      ),
    ).toBe(false);
  });
  it("displays recorded bundle allocations and saves their native identity without preparing replacement batches", async () => {
    const allocations = [
      {
        name: "BUNDLE-ROW-A",
        batch_no: "BATCH-A",
        stock_qty: 2,
        expiry_date: "2026-10-20",
      },
      {
        name: "BUNDLE-ROW-B",
        batch_no: "BATCH-B",
        stock_qty: 3,
        expiry_date: "2026-11-20",
      },
    ];
    const original = document({
      kind: "Receive",
      ti_movement_kind: "Receive",
      posting_date: "2026-10-16",
      posting_time: "12:00:00",
      items: [
        {
          name: "ROW-A",
          item_code: "ITEM-A",
          qty: 5,
          uom: "Nos",
          stock_uom: "Nos",
          conversion_factor: 1,
          transfer_qty: 5,
          t_warehouse: "ROOM-A",
          batch_no: "",
          serial_and_batch_bundle: "BUNDLE-A",
          recorded_bundle: "BUNDLE-A",
          recorded_batch_allocations: allocations,
        },
      ],
    });
    const call = vi.fn(
      async (method: string, args: Record<string, any> = {}) => {
        if (method === "native_api.load_document") return original;
        if (method === "catalog.operation_items")
          return {
            items: [{ ...item, has_batch_no: true, has_expiry_date: true }],
            errors: [],
          };
        if (method === "catalog.batch_metadata_many")
          return {
            "BATCH-OLD": {
              item_code: item.item_code,
              expiry_date: "",
              manufacturing_date: "",
            },
          };
        if (method === "native_files.attachments") return [];
        if (method === "native_api.save_document")
          return { ...document(args.data, "v2"), items: original.items };
        throw new Error(`Unexpected ${method}`);
      },
    );
    const { controller: c } = setup(
      () =>
        useOperationEditor({
          identity: { doctype: "Stock Entry", name: original.name },
        }),
      call,
      vi.fn(),
      (controller) => h(AllocationSummary, { draft: controller.draft.value }),
    );
    await flushPromises();
    const wrapper = wrappers.at(-1)!;
    expect(wrapper.text()).toContain("BATCH-A 2 Nos");
    expect(wrapper.text()).toContain("BATCH-B 3 Nos");
    expect(wrapper.text()).toContain("2026-10-20");
    expect(wrapper.text()).not.toContain("自动生成");
    expect(c.issues.value).toEqual([]);
    c.draft.value.note = "保留原批次分配";
    await c.save();
    expect(c.state.status).toBe("saved");
    const sent = call.mock.calls.find(
      ([method]) => method === "native_api.save_document",
    )?.[1]?.data;
    expect(sent.items[0]).toMatchObject({
      name: "ROW-A",
      batch_no: null,
      serial_and_batch_bundle: "BUNDLE-A",
      use_serial_batch_fields: 0,
      qty: 5,
      conversion_factor: 1,
    });
    expect(
      call.mock.calls.some(([method]) => method === "catalog.receipt_batches"),
    ).toBe(false);
  });
  it("keeps an explicitly selected warehouse source even when another location has stock", async () => {
    const { controller: c, call } = setup(
      () =>
        useOperationEditor({
          kind: "Issue",
          initialWarehouse: "ROOM-B",
          initialItems: ["ITEM-A"],
        }),
      service(),
    );
    await flushPromises();
    expect(c.draft.value.items[0]).toMatchObject({
      code: "ITEM-A",
      sourceLocation: "ROOM-B",
      location: "ROOM-B",
      qty: 1,
    });
    expect(c.draft.value.preferredWarehouse).toBe("ROOM-B");
    expect(
      call.mock.calls.some((args) => args[0] === "native_api.create_document"),
    ).toBe(false);
    const receive = setup(
      () =>
        useOperationEditor({
          kind: "Receive",
          initialWarehouse: "ROOM-B",
          initialItems: ["ITEM-A"],
        }),
      service(),
    );
    await flushPromises();
    expect(receive.controller.draft.value.items[0]?.location).toBe("ROOM-B");
  });
  it("prefills Repair from the chosen damaged allocation and requires an explicit physical destination", async () => {
    const base = service(),
      call = vi.fn(async (method, args) =>
        method === "catalog.operation_items"
          ? {
              items: [
                {
                  ...item,
                  stock: [{ warehouse: "DAMAGED", damaged: 5, available: 0 }],
                },
              ],
              errors: [],
            }
          : base(method, args),
      );
    const { controller: c } = setup(
      () =>
        useOperationEditor({
          kind: "Repair",
          initialAllocations: [
            { item_code: "ITEM-A", warehouse: "DAMAGED", batch_no: "", qty: 3 },
          ],
        }),
      call,
    );
    await flushPromises();
    expect(c.state.identity).toBeUndefined();
    expect(c.draft.value.items[0]).toMatchObject({
      code: "ITEM-A",
      sourceLocation: "DAMAGED",
      location: "",
      qty: 3,
    });
    expect(c.issues.value.some((issue) => issue.field === "location")).toBe(
      true,
    );
    c.draft.value.items[0]!.location = "ROOM-B";
    await c.save();
    const data = call.mock.calls.find(
      ([method]) => method === "native_api.create_document",
    )?.[1].data;
    expect(data.items[0]).toMatchObject({
      s_warehouse: "DAMAGED",
      t_warehouse: "ROOM-B",
      qty: 3,
      ti_original_loan: null,
    });
  });
  it("preserves separate Desk loan destinations when encoding an unrelated edit", () => {
    const reference = createReferenceData();
    const value = decodeOperation(
      document({
        ti_movement_kind: "Loan",
        items: ["LEASED-A", "LEASED-B"].map((t_warehouse) => ({
          item_code: "ITEM-A",
          qty: 2,
          uom: "Nos",
          conversion_factor: 1,
          s_warehouse: "ROOM-A",
          t_warehouse,
        })),
      }),
    );
    value.note = "更新备注";
    const data = encodeOperation(value, reference);
    expect(
      (data.items as Record<string, unknown>[]).map((row) => row.t_warehouse),
    ).toEqual(["LEASED-A", "LEASED-B"]);
  });
  it("starts a fresh damaged Return with every exact original row and batch reference", async () => {
    const base = service();
    const call = vi.fn(async (method, args) => {
      if (method !== "native_api.loan_detail") return base(method, args);
      return {
        name: "ORIGINAL-LOAN",
        doctype: "Stock Entry",
        kind: "Loan",
        docstatus: 1,
        ti_borrower: "借用方",
        ti_activity: "ACT-A",
        items: ["ORIGINAL-ROW-A", "ORIGINAL-ROW-B"].map((name, index) => ({
          name,
          item_code: "ITEM-A",
          s_warehouse: "ROOM-A",
          t_warehouse: "LEASED",
          stock_uom: "Nos",
          uom: "Nos",
          conversion_factor: 1,
          allocations: [{ batch_no: "", outstanding_qty: index + 2 }],
        })),
      };
    });
    const { controller: c } = setup(
      () =>
        useOperationEditor({
          kind: "Return",
          originalLoan: "ORIGINAL-LOAN",
          initialReturnOutcome: "damaged",
        }),
      call,
    );
    await flushPromises();
    expect(c.state.identity).toBeUndefined();
    expect(
      c.draft.value.items.map((line) => [
        line.originalLoanLine,
        line.returnOutcome,
      ]),
    ).toEqual([
      ["ORIGINAL-ROW-A", "damaged"],
      ["ORIGINAL-ROW-B", "damaged"],
    ]);
    await c.save();
    const sent = call.mock.calls.find(
      ([method]) => method === "native_api.create_document",
    )?.[1].data;
    expect(sent.items).toHaveLength(2);
    expect(sent.items[1]).toMatchObject({
      ti_original_loan: "ORIGINAL-LOAN",
      ti_original_loan_line: "ORIGINAL-ROW-B",
      ti_settlement_outcome: "Damaged",
      s_warehouse: "LEASED",
      t_warehouse: "DAMAGED",
    });
    expect(c.draft.value.activity).toBe("ACT-A");
  });
  it("retains invalid input locally and creates one valid native draft before explicit submission", async () => {
    const call = service();
    const { controller: c } = setup(
      () => useOperationEditor({ kind: "Receive", initialItems: ["ITEM-A"] }),
      call,
    );
    await flushPromises();
    c.draft.value.items[0]!.location = "";
    await c.save(true);
    expect(
      call.mock.calls.filter(
        ([method]) => method === "native_api.create_document",
      ),
    ).toHaveLength(0);
    expect(c.recovery.list().entries[0]?.values.items).toHaveLength(1);
    c.draft.value.items[0]!.location = "ROOM-A";
    await c.save();
    expect(c.state.identity?.name).toBe("STE-1");
    expect(c.draft.value.items[0]!.name).toBe("CHILD-0");
    expect(c.state.status).toBe("saved");
    expect(
      call.mock.calls.some(
        ([method]) => method === "native_api.submit_document",
      ),
    ).toBe(false);
    await c.review();
    expect(c.reviewOpen.value).toBe(true);
    await c.confirm();
    expect(c.state.status).toBe("submitted");
    expect(c.writable.value).toBe(false);
    expect(
      call.mock.calls.filter(
        ([method]) => method === "native_api.create_document",
      ),
    ).toHaveLength(1);
  });
  it("preserves a concurrent edit while a native save is in flight", async () => {
    let finish!: (value: NativeDocument) => void;
    const base = service();
    const call = vi.fn(async (method, args) =>
      method === "native_api.create_document"
        ? new Promise<NativeDocument>((resolve) => {
            finish = resolve;
          })
        : base(method, args),
    );
    const { controller: c } = setup(
      () => useOperationEditor({ kind: "Receive", initialItems: ["ITEM-A"] }),
      call,
    );
    await flushPromises();
    c.draft.value.items[0]!.location = "ROOM-A";
    const saving = c.save();
    await flushPromises();
    c.draft.value.note = "保存途中补充";
    finish(
      document(
        call.mock.calls.find(
          ([method]) => method === "native_api.create_document",
        )![1].data,
      ),
    );
    await saving;
    expect(c.draft.value.note).toBe("保存途中补充");
    expect(
      call.mock.calls.find(
        ([method]) => method === "native_api.save_document",
      )?.[1].data.remarks,
    ).toBe("保存途中补充");
  });
  it("blocks confirmation until failed private attachments complete and retains upload retry", async () => {
    const call = service(),
      upload = vi
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue({
          name: "FILE-1",
          file_name: "note.txt",
          file_url: "/private/files/note.txt",
          is_private: 1,
        });
    const { controller: c } = setup(
      () => useOperationEditor({ kind: "Receive", initialItems: ["ITEM-A"] }),
      call,
      upload,
    );
    await flushPromises();
    c.draft.value.items[0]!.location = "ROOM-A";
    c.files.add([new File(["private"], "note.txt", { type: "text/plain" })]);
    await c.confirm();
    expect(c.files.incomplete.value).toBe(true);
    expect(
      call.mock.calls.some(
        ([method]) => method === "native_api.submit_document",
      ),
    ).toBe(false);
    expect(c.files.files[0]?.state).toBe("error");
    await c.confirm();
    expect(c.state.status).toBe("submitted");
    expect(upload).toHaveBeenCalledTimes(2);
  });
  it("keeps exact original child and batch identities for compatible partial settlements", async () => {
    const base = service();
    const call = vi.fn(async (method, args) =>
      method === "native_api.loan_detail"
        ? {
            ...document({
              ti_movement_kind: "Loan",
              items: [
                {
                  item_code: "ITEM-A",
                  name: "ORIGINAL-LINE",
                  s_warehouse: "ROOM-A",
                  t_warehouse: "LEASED",
                  stock_uom: "Nos",
                  uom: "Nos",
                  qty: 10,
                  conversion_factor: 1,
                  allocations: [
                    { batch_no: "BATCH-A", outstanding_qty: 3 },
                    { batch_no: "BATCH-B", outstanding_qty: 2 },
                  ],
                },
              ],
            }),
            name: args.name,
            docstatus: 1,
            kind: "Loan",
            ti_borrower: "志工组",
            ti_activity: "ACT-1",
          }
        : base(method, args),
    );
    const { controller: c, reference } = setup(
      () => useOperationEditor({ kind: "Return", originalLoan: "LOAN-1" }),
      call,
    );
    await flushPromises();
    expect(c.draft.value.items).toHaveLength(2);
    expect(c.draft.value.items.map((line) => line.originalLoanLine)).toEqual([
      "ORIGINAL-LINE",
      "ORIGINAL-LINE",
    ]);
    c.draft.value.items[0]!.qty = 1;
    c.draft.value.items[0]!.entryQty = 1;
    const data = encodeOperation(c.draft.value, reference);
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ti_original_loan: "LOAN-1",
          ti_original_loan_line: "ORIGINAL-LINE",
          batch_no: "BATCH-A",
          qty: 1,
        }),
      ]),
    );
  });
  it("refuses to restore stale native recovery over an external version", async () => {
    const base = service();
    const call = vi.fn(async (method, args) =>
      method === "native_api.load_document"
        ? document({ ti_movement_kind: "Receive", items: [] }, "external")
        : base(method, args),
    );
    const { controller: c } = setup(
      () => useOperationEditor({ kind: "Receive" }),
      call,
    );
    await flushPromises();
    const snapshot = {
      schema: 1 as const,
      site: "unit-site",
      account: "volunteer",
      tabId: "old-tab",
      editorId: "old-editor",
      editorKind: "Stock Entry",
      identity: { doctype: "Stock Entry" as const, name: "STE-1" },
      baseVersion: "old",
      revision: 2,
      updatedAt: "2026-10-16",
      values: { ...c.state.values, note: "不能覆盖" },
      pendingUploadReselection: false,
    };
    await c.recover(snapshot as never);
    expect(c.draft.value.note).not.toBe("不能覆盖");
    expect(c.state.error).toContain("原记录已更改");
  });
});
it("does not use frontend DocType capabilities to gate stock confirmation", async () => {
  const call = service();
  const { controller: c } = setup(
    () => useOperationEditor({ kind: "Receive", initialItems: ["ITEM-A"] }),
    call,
  );
  await flushPromises();
  c.draft.value.items[0]!.location = "ROOM-A";
  await c.save();
  expect(c.state.status).toBe("saved");
  expect(c.canSubmit.value).toBe(true);
  await c.confirm();
  expect(
    call.mock.calls.some(([method]) => method === "native_api.submit_document"),
  ).toBe(true);
});
describe("movement codec", () => {
  it("preserves recorded conversions and native identities independently of Item defaults", () => {
    const doc = document({
      ti_movement_kind: "Transfer",
      items: [
        {
          name: "ROW-A",
          item_code: "ITEM-A",
          qty: 2,
          uom: "箱",
          stock_uom: "Nos",
          conversion_factor: 12,
          s_warehouse: "ROOM-A",
          t_warehouse: "ROOM-B",
          ti_allocation_note: "保留原因",
        },
      ],
    });
    const value = decodeOperation(doc);
    expect(value.items[0]?.qty).toBe(24);
    const reference = createReferenceData();
    const sent = encodeOperation(value, reference);
    expect(sent.items).toEqual([
      expect.objectContaining({
        name: "ROW-A",
        qty: 2,
        uom: "箱",
        conversion_factor: 12,
        ti_allocation_note: "保留原因",
      }),
    ]);
    expect(newOperation("Loan", reference).name).toBe("");
  });
});
describe("pending file lifecycle", () => {
  it("keeps new-parent files in memory and recovers them only as reselection entries", async () => {
    let parent: { doctype: string; name: string } | undefined;
    const upload = vi.fn().mockResolvedValue({
      name: "FILE",
      file_name: "note.txt",
      file_url: "/private/files/note.txt",
      is_private: 1,
    });
    const { controller: files } = setup(
      () =>
        useAttachments({
          parent: () => parent,
          writable: () => true,
          currentAccount: () => "volunteer",
          account: "volunteer",
        }),
      vi.fn(),
      upload,
    );
    files.add([new File(["content"], "note.txt")]);
    expect(upload).not.toHaveBeenCalled();
    expect(files.files[0]?.state).toBe("pending");
    parent = { doctype: "Stock Entry", name: "STE" };
    await files.finalize();
    expect(files.files[0]?.serverName).toBe("FILE");
    files.restore([
      {
        id: "unloaded",
        name: "other.txt",
        type: "text/plain",
        url: "blob:old",
        state: "pending",
        progress: 0,
        error: "",
      },
    ]);
    expect(files.files[1]).toMatchObject({ state: "reselect", url: undefined });
    expect(files.incomplete.value).toBe(true);
  });
});

it("initializes selected Items atomically and only once across lookup retries and reloads", async () => {
  const base = service();
  let fail = true;
  const call = vi.fn(async (method, args) => {
    if (
      method === "catalog.operation_items" &&
      (args.item_codes as string[]).includes("ITEM-B")
    ) {
      if (fail) throw new Error("物品暂不可用");
      return {
        items: (args.item_codes as string[]).map((item_code) => ({
          ...structuredClone(item),
          item_code,
        })),
        errors: [],
      };
    }
    return base(method, args);
  });
  const { controller: c } = setup(
    () =>
      useOperationEditor({
        kind: "Transfer",
        initialItems: ["ITEM-A", "ITEM-B", "ITEM-A"],
      }),
    call,
  );
  await flushPromises();
  expect(c.draft.value.items).toHaveLength(0);
  expect(c.state.error).toBe("物品暂不可用");
  fail = false;
  await c.load();
  expect(c.state.error).toBe("");
  expect(c.draft.value.items.map((line) => line.code)).toEqual([
    "ITEM-A",
    "ITEM-B",
  ]);
  const first = c.draft.value.items[0]!;
  first.entryQty = first.qty = 7;
  c.draft.value.items.pop();
  await c.load();
  expect(c.draft.value.items).toHaveLength(1);
  expect(c.draft.value.items[0]).toMatchObject({ id: first.id, qty: 7 });
});
