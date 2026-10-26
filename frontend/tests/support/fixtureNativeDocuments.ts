/** Isolated native-shaped data for the development gallery. */
import {
  reviewSession,
  reviewSessionGeneration,
  reviewMovementRows,
  type ReviewDraft,
} from "./reviewModel";
import { fixtureStockRows } from "./fixtureStock";
import { previewDate } from "./model";
import { activityLabel } from "./activityData";
import { historicalEvents } from "./reportModel";
import type { NativeDocument } from "../../src/features/documents/nativeEditor";
import type {
  NativeFile,
  CatalogItem,
} from "../../src/lib/catalogPresentation";
import type { CountRow } from "../../src/features/counts/countModel";
import { decodeOperation } from "../../src/features/documents/operationCodec";
const documents = new Map<string, NativeDocument>();
const requests = new Map<string, string>();
const files = new Map<string, NativeFile[]>();
const batches = new Map<string, Record<string, unknown>>();
const fileDisplays = new Map<string, string>();
export function fixtureFileDisplayUrl(file: {
  name: string;
  file_url: string;
}) {
  return fileDisplays.get(file.name) || file.file_url;
}
let sequence = 0;
let generation = -1;
function synchronizeSession() {
  if (generation === reviewSessionGeneration) return;
  generation = reviewSessionGeneration;
  documents.clear();
  requests.clear();
  files.clear();
  batches.clear();
  fileDisplays.clear();
  sequence = 0;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixtureBatch(name: string): Record<string, unknown> | undefined {
  if (batches.has(name)) return copy(batches.get(name));
  for (const item of reviewSession.stock)
    for (const place of item.locations)
      for (const batch of place.batches || [])
        if (batch.id === name)
          return {
            name: batch.id,
            item_code: item.code,
            expiry_date: batch.expiry || "",
            manufacturing_date: "",
            disabled: false,
          };
  for (const draft of reviewSession.drafts)
    for (const line of draft.lines)
      if (line.batch === name)
        return {
          name: line.batch,
          item_code: line.code,
          expiry_date: line.expiry || "",
          manufacturing_date: line.manufacturingDate || "",
          disabled: false,
        };
  return undefined;
}

function key(doctype: string, name: string) {
  return JSON.stringify([doctype, name]);
}
export function fixtureCatalogItem(code: string): CatalogItem {
  synchronizeSession();
  const row = reviewSession.stock.find((row) => row.code === code);
  if (!row)
    throw Object.assign(new Error("物品不存在或不可访问"), {
      kind: "DoesNotExistError",
    });
  return {
    item_code: row.code,
    item_name: row.name,
    item_group: row.category,
    stock_uom: row.uom,
    image: row.images?.[0] || "",
    description: row.description || "",
    version: String(row.conversionVersion || 0),
    can_edit: true,
    has_batch_no: row.tracksBatch,
    has_expiry_date: row.tracksExpiry,
    barcodes: (row.barcode || "")
      .split("\n")
      .filter(Boolean)
      .map((barcode) => ({ barcode })),
    uoms: [
      { uom: row.uom, conversion_factor: 1 },
      ...(row.alternateUnits || []).map((unit) => ({
        uom: unit.uom,
        conversion_factor: unit.factor,
      })),
    ],
    attachments: copy(files.get(key("Item", code)) || []),
    stock: fixtureStockRows(row),
  };
}
function normalize(
  data: Record<string, unknown>,
  name: string,
  version: number,
  docstatus = 0,
): NativeDocument {
  return {
    ...copy(data),
    name,
    doctype: String(data.doctype || "Stock Entry") as NativeDocument["doctype"],
    version: String(version),
    modified: String(version),
    kind: String(data.ti_movement_kind || data.kind || "Receive"),
    posting_date: data.posting_date || previewDate,
    posting_time: data.posting_time || "10:00:00",
    docstatus: docstatus as 0 | 1 | 2,
    editable: docstatus === 0,
    items: ((data.items || []) as Record<string, unknown>[]).map(
      (line, index) => ({
        ...line,
        name: line.name || `${name}-ROW-${index + 1}`,
        stock_uom:
          reviewSession.stock.find((item) => item.code === line.item_code)
            ?.uom ||
          line.stock_uom ||
          line.uom,
        transfer_qty: Number(line.qty) * Number(line.conversion_factor || 1),
      }),
    ),
  };
}
export function registerFixtureDraft(draft: ReviewDraft) {
  synchronizeSession();
  const name = draft.name;
  const data = {
    doctype:
      draft.kind === "Reconcile" ? "Stock Reconciliation" : "Stock Entry",
    ti_movement_kind: draft.kind,
    posting_date: draft.postingDate,
    posting_time: draft.postingTime || "10:00:00",
    ti_time_mode: draft.timeMode === "manual" ? "Manual" : "Current",
    ti_source_text: draft.source || "",
    ti_purpose_text: draft.purpose || "",
    ti_activity: draft.activity,
    ti_borrower: draft.borrower,
    remarks: draft.note,
    ti_recorder_name: draft.recorder,
    ti_handler_name: draft.handler,
    ti_reviewer_name: draft.reviewer,
    items: draft.lines.map((line) => ({
      name: line.id,
      item_code: line.code,
      qty: line.entryQty ?? line.qty,
      uom: line.entryUom || line.uom,
      conversion_factor: line.conversionFactor || 1,
      s_warehouse:
        draft.kind === "Receive" ? null : line.sourceLocation || line.location,
      t_warehouse: ["Issue", "Loss", "Disposal"].includes(draft.kind)
        ? null
        : draft.kind === "Loan"
          ? "借出"
          : draft.kind === "Damage"
            ? "损坏待处理 / 斋堂"
            : line.location,
      batch_no: line.batch || "",
      ti_original_loan: line.loanName || draft.loanName || null,
      ti_original_loan_line:
        line.loanName || draft.loanName
          ? `${line.loanName || draft.loanName}-ROW-${(line.loanLineIndex || 0) + 1}`
          : null,
      ti_settlement_outcome:
        line.returnOutcome === "damaged"
          ? "Damaged"
          : line.returnOutcome === "lost"
            ? "Lost"
            : line.loanName || draft.loanName
              ? "Returned"
              : null,
      ti_allocation_note: line.reason || "",
    })),
  };
  const doc = normalize(
    data,
    name,
    draft.version || 1,
    draft.status === "completed" ? 1 : draft.status === "cancelled" ? 2 : 0,
  );
  documents.set(key(doc.doctype, name), doc);
  return copy(doc);
}
function countFingerprint(
  rows: CountRow[],
  warehouses: string[],
  timestamp: string,
  scope: string,
) {
  return JSON.stringify([
    [...warehouses].sort(),
    timestamp,
    scope,
    rows.map((row) => [
      row.item_code,
      row.warehouse,
      row.batch_no || "",
      row.baseline_qty,
    ]),
  ]);
}
function countBaseline(args: Record<string, unknown>) {
  const selected = (args.item_codes as string[]) || [],
    warehouses = [...new Set((args.warehouses as string[]) || [])].sort(),
    timestamp = String(args.timestamp),
    scope = String(args.scope);
  const oldRows = (args.previous_rows as CountRow[]) || [];
  const rows: CountRow[] = [];
  for (const item of reviewSession.stock) {
    if (scope === "Selected" && !selected.includes(item.code)) continue;
    for (const warehouse of warehouses) {
      const location = item.locations.find((row) => row.location === warehouse);
      if (!location && scope !== "Selected") continue;
      const allocations = item.tracksBatch
        ? location?.batches
            ?.filter((batch) => batch.available)
            .map((batch) => ({ batch: batch.id, qty: batch.available })) || []
        : [{ batch: "", qty: location?.available || 0 }];
      for (const allocation of allocations) {
        const old = oldRows.find(
            (row) =>
              row.item_code === item.code &&
              row.warehouse === warehouse &&
              (row.batch_no || "") === allocation.batch,
          ),
          changed = !!old && old.baseline_qty !== allocation.qty;
        rows.push({
          item_code: item.code,
          warehouse,
          batch_no: allocation.batch || null,
          stock_uom: item.uom,
          baseline_qty: allocation.qty,
          actual_qty: old?.actual_qty ?? null,
          review_state: changed
            ? "Unreviewed"
            : old?.review_state || "Unreviewed",
          reason: old?.reason || "",
          needs_review: !old || changed,
        });
      }
    }
  }
  return {
    rows,
    timestamp,
    fingerprint: countFingerprint(rows, warehouses, timestamp, scope),
    removed_rows: oldRows.filter(
      (row) =>
        !rows.some(
          (current) =>
            current.item_code === row.item_code &&
            current.warehouse === row.warehouse &&
            current.batch_no === row.batch_no,
        ),
    ),
  };
}
export function registerFixtureCount(draft: ReviewDraft) {
  synchronizeSession();
  const warehouses = draft.countWarehouses?.length
    ? [...new Set(draft.countWarehouses)].sort()
    : [
        ...new Set(draft.lines.map((line) => line.location).filter(Boolean)),
      ].sort();
  const rows: CountRow[] = draft.lines.map((line) => ({
    item_code: line.code,
    warehouse: line.location,
    batch_no: line.batch || null,
    stock_uom: line.uom,
    baseline_qty: line.qty,
    actual_qty: line.countedQty ?? null,
    review_state: line.countedQty === undefined ? "Unreviewed" : "Reviewed",
    reason: line.reason || "",
  }));
  const scope = draft.countMode === "full" ? "Full Location" : "Selected",
    timestamp = `${draft.postingDate} ${draft.postingTime || "10:00:00"}`;
  const doc = normalize(
    {
      doctype: "Stock Reconciliation",
      purpose: "Stock Reconciliation",
      kind: "Reconcile",
      posting_date: draft.postingDate,
      posting_time: draft.postingTime || "10:00:00",
      ti_count_warehouses: warehouses,
      ti_count_scope: scope,
      ti_count_items: [...new Set(rows.map((row) => row.item_code))],
      ti_count_review: rows,
      ti_baseline_timestamp: timestamp,
      ti_baseline_fingerprint: countFingerprint(
        rows,
        warehouses,
        timestamp,
        scope,
      ),
      ti_activity: draft.activity,
      ti_notes: draft.note,
      items: rows
        .filter(
          (row) =>
            row.actual_qty !== null && row.actual_qty !== row.baseline_qty,
        )
        .map((row) => ({
          item_code: row.item_code,
          warehouse: row.warehouse,
          batch_no: row.batch_no,
          stock_uom: row.stock_uom,
          current_qty: row.baseline_qty,
          qty: row.actual_qty,
          conversion_factor: 1,
        })),
    },
    draft.name,
    draft.version || 1,
    draft.status === "completed" ? 1 : draft.status === "cancelled" ? 2 : 0,
  );
  documents.set(key(doc.doctype, doc.name), doc);
  return copy(doc);
}

function find(doctype: string, name: string) {
  const stored = documents.get(key(doctype, name));
  if (stored) return stored;
  const history = historicalEvents.filter((event) => event.documentId === name);
  if (history.length) {
    const event = history[0]!;
    const transfer = history.length === 2;
    const reconciliation = name === "HIST-COUNT";
    const kind = reconciliation
      ? "Reconcile"
      : transfer
        ? "Transfer"
        : name === "HIST-REVERSAL"
          ? "Issue"
          : "Receive";
    const source = transfer
      ? history.find((event) => event.outgoing)?.locationId
      : kind === "Issue"
        ? event.locationId
        : "";
    const target = transfer
      ? history.find((event) => event.incoming)?.locationId
      : kind === "Receive"
        ? event.locationId
        : "";
    const quantity = reconciliation
      ? 117
      : Math.abs(event.incoming || event.outgoing);
    const doc = normalize(
      {
        doctype: reconciliation ? "Stock Reconciliation" : "Stock Entry",
        kind,
        purpose: reconciliation
          ? "Stock Reconciliation"
          : transfer
            ? "Material Transfer"
            : kind === "Issue"
              ? "Material Issue"
              : "Material Receipt",
        posting_date: event.date,
        posting_time: "09:00:00",
        ti_count_items: "[]",
        items: [
          {
            item_code: event.itemId,
            qty: quantity,
            stock_uom: event.stockUom,
            uom: event.stockUom,
            conversion_factor: 1,
            s_warehouse: source,
            t_warehouse: target,
            ...(reconciliation
              ? { warehouse: event.locationId, current_qty: 120 }
              : {}),
          },
        ],
      },
      name,
      1,
      event.status === "已取消" ? 2 : 1,
    );
    documents.set(key(doctype, name), doc);
    return doc;
  }
  const draft = reviewSession.drafts.find((row) => row.name === name);
  if (draft)
    return draft.kind === "Reconcile"
      ? registerFixtureCount(draft)
      : registerFixtureDraft(draft);
  const rows = reviewMovementRows().filter((row) => row.name === name);
  if (rows.length) {
    const first = rows[0]!;
    const reconciliation = ["Opening", "Reconcile"].includes(first.kind);
    const actualType = reconciliation ? "Stock Reconciliation" : "Stock Entry";
    if (doctype !== actualType) throw new Error("原生记录类型不匹配");
    const doc = normalize(
      {
        doctype,
        kind: first.kind,
        purpose: reconciliation
          ? first.kind === "Opening"
            ? "Opening Stock"
            : "Stock Reconciliation"
          : first.stockPurpose,
        ti_movement_kind: reconciliation ? undefined : first.kind,
        posting_date: first.date,
        posting_time: first.postingTime || "10:00:00",
        ti_activity: first.activity || "",
        ti_borrower: first.borrower || "",
        items: rows.map((row) => ({
          name: row.lineId,
          item_code: row.code,
          qty: reconciliation
            ? (row.countedQty ?? row.qty)
            : (row.entryQty ?? row.qty),
          uom: row.entryUom || row.uom,
          conversion_factor: row.conversionFactor || 1,
          stock_uom: row.uom,
          current_qty: row.bookQty || 0,
          warehouse: reconciliation ? row.to : undefined,
          s_warehouse: ["Receive", "Opening", "Reconcile"].includes(row.kind)
            ? undefined
            : row.from,
          t_warehouse: ["Issue", "Loss", "Disposal"].includes(row.kind)
            ? undefined
            : row.to,
          batch_no: row.batch || "",
          ti_original_loan: row.loanName,
          ti_original_loan_line: row.loanName
            ? `${row.loanName}-ROW-${(row.loanLineIndex || 0) + 1}`
            : undefined,
          ti_settlement_outcome: row.loanName
            ? row.kind === "Loss"
              ? "Lost"
              : row.kind === "Damage"
                ? "Damaged"
                : "Returned"
            : undefined,
        })),
      },
      name,
      1,
      first.docstatus,
    );
    if (first.kind === "Opening") doc.editable = false;
    documents.set(key(doctype, name), doc);
    return doc;
  }
  throw Object.assign(new Error("原生记录不存在或不可访问"), {
    kind: "DoesNotExistError",
  });
}
function syncSavedDocument(doc: NativeDocument) {
  const input = decodeOperation(doc);
  const value: ReviewDraft = {
    name: doc.name,
    documentType: doc.doctype,
    kind: doc.doctype === "Stock Reconciliation" ? "Reconcile" : input.kind,
    saved: true,
    version: Number(doc.version),
    status: input.status,
    postingDate: input.postingDate,
    postingTime: input.postingTime,
    timeMode: input.timeMode,
    activity: input.activity,
    borrower: input.borrower,
    note: input.note,
    source: input.source,
    purpose: input.purpose,
    lines: input.items,
  };
  if (doc.doctype === "Stock Reconciliation") {
    const warehouses =
      typeof doc.ti_count_warehouses === "string"
        ? JSON.parse(doc.ti_count_warehouses || "[]")
        : doc.ti_count_warehouses;
    value.countWarehouses = Array.isArray(warehouses) ? warehouses : [];
    value.countMode =
      doc.ti_count_scope === "Full Location" ? "full" : "selective";
    value.lines = ((doc.ti_count_review || []) as CountRow[]).map((row) => ({
      id: `${row.item_code}:${row.batch_no || ""}`,
      code: row.item_code,
      location: row.warehouse,
      batch: row.batch_no || "",
      uom: row.stock_uom,
      qty: row.baseline_qty,
      countedQty: row.actual_qty ?? undefined,
      countState: row.review_state === "Unreviewed" ? undefined : "counted",
      reason: row.reason,
    }));
  }
  const previous = reviewSession.drafts.find((row) => row.name === value.name);
  if (previous) Object.assign(previous, value);
  else reviewSession.drafts.push(value);
}
export async function fixtureNativeCall(
  endpoint: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  synchronizeSession();
  if (endpoint === "counts.count_baseline") return countBaseline(args);
  if (endpoint === "counts.save_count") {
    const data = args.data as Record<string, unknown>,
      rows = data.ti_count_review as CountRow[];
    const differences = rows.filter(
      (row) =>
        row.review_state !== "Unreviewed" &&
        row.actual_qty !== row.baseline_qty,
    );
    if (!differences.length)
      return { no_adjustment: true, existing_draft: args.name || null };
    const payload = {
      ...data,
      doctype: "Stock Reconciliation",
      purpose: "Stock Reconciliation",
      kind: "Reconcile",
      items: differences.map((row) => ({
        item_code: row.item_code,
        warehouse: row.warehouse,
        batch_no: row.batch_no,
        qty: row.actual_qty,
        stock_uom: row.stock_uom,
        current_qty: row.baseline_qty,
        conversion_factor: 1,
      })),
    };
    return fixtureNativeCall(
      args.name ? "native_api.save_document" : "native_api.create_document",
      { ...args, doctype: "Stock Reconciliation", data: payload },
    );
  }
  if (endpoint === "native_api.editor_clock")
    return { timestamp: `${previewDate} 10:00:00` };
  if (endpoint === "native_api.loan_detail") {
    const loan = reviewSession.loans.find((row) => row.name === args.name);
    if (!loan) throw new Error("原借出记录不存在");
    return {
      name: loan.name,
      doctype: "Stock Entry",
      kind: "Loan",
      version: "1",
      docstatus: loan.status === "draft" ? 0 : 1,
      editable: false,
      ti_borrower: loan.borrower,
      ti_activity: loan.activity,
      posting_date: loan.loanDate,
      posting_time: "10:00:00",
      balance_at: `${previewDate} 10:00:00`,
      activity_title: loan.activity ? activityLabel(loan.activity) : "",
      items: loan.lines.map((line, index) => ({
        name: `${loan.name}-ROW-${index + 1}`,
        item_code: line.code,
        item_name:
          reviewSession.stock.find((row) => row.code === line.code)?.name ||
          line.code,
        stock_uom:
          reviewSession.stock.find((row) => row.code === line.code)?.uom ||
          "Nos",
        uom:
          reviewSession.stock.find((row) => row.code === line.code)?.uom ||
          "Nos",
        qty: line.qty,
        conversion_factor: 1,
        transfer_qty: line.qty,
        s_warehouse: line.location || "斋堂 / A-01",
        t_warehouse: "借出",
        outcomes: {
          Returned: line.returned,
          Damaged: line.damaged,
          Lost: line.lost,
        },
        outstanding_qty:
          loan.status === "draft"
            ? 0
            : Math.max(0, line.qty - line.returned - line.damaged - line.lost),
        allocations: [
          {
            batch_no: line.batch || "",
            borrowed_qty: line.qty,
            outcomes: {
              Returned: line.returned,
              Damaged: line.damaged,
              Lost: line.lost,
            },
            outstanding_qty:
              loan.status === "draft"
                ? 0
                : Math.max(
                    0,
                    line.qty - line.returned - line.damaged - line.lost,
                  ),
          },
        ],
      })),
    };
  }
  if (endpoint === "native_api.create_document") {
    const request = key(String(args.doctype), String(args.request_id)),
      previous = requests.get(request);
    if (previous) return copy(find(String(args.doctype), previous));
    const name = `GALLERY-STE-${++sequence}`,
      doc = normalize(
        { ...(args.data as Record<string, unknown>), doctype: args.doctype },
        name,
        1,
      );
    documents.set(key(doc.doctype, name), doc);
    requests.set(request, name);
    syncSavedDocument(doc);
    return copy(doc);
  }
  if (endpoint.startsWith("native_api.")) {
    const doc = find(String(args.doctype), String(args.name));
    if (endpoint === "native_api.load_document") return copy(doc);
    if (
      endpoint === "native_api.submit_document" &&
      doc.docstatus === 1 &&
      doc.ti_confirmation_version === args.version
    )
      return copy(doc);
    if (String(doc.version) !== String(args.version))
      throw Object.assign(new Error("记录已更改，输入保持原样"), {
        kind: "TimestampMismatchError",
      });
    if (endpoint === "native_api.delete_document") {
      if (doc.docstatus !== 0) throw new Error("只能删除草稿");
      documents.delete(key(doc.doctype, doc.name));
      const index = reviewSession.drafts.findIndex(
        (row) => row.name === doc.name,
      );
      if (index >= 0) reviewSession.drafts.splice(index, 1);
      return { deleted: true };
    }
    if (
      ["native_api.amend_document", "native_api.duplicate_document"].includes(
        endpoint,
      )
    ) {
      const duplicate = endpoint === "native_api.duplicate_document";
      if (!duplicate && doc.docstatus !== 2)
        throw new Error("只能修订已取消记录");
      const request = key(doc.doctype, String(args.request_id));
      const previous = requests.get(request);
      if (previous) return copy(find(doc.doctype, previous));
      const name = `GALLERY-STE-${++sequence}`,
        amended = normalize(
          {
            ...doc,
            amended_from: duplicate ? null : doc.name,
            ti_confirmation_version: undefined,
            items: doc.items.map(({ name: _name, ...row }) => row),
          },
          name,
          1,
        );
      documents.set(key(doc.doctype, name), amended);
      requests.set(request, name);
      syncSavedDocument(amended);
      return copy(amended);
    }
    if (endpoint === "native_api.save_document" && doc.docstatus !== 0)
      throw new Error("记录已完成或取消");
    const docstatus =
      endpoint === "native_api.submit_document"
        ? 1
        : endpoint === "native_api.cancel_document"
          ? 2
          : 0;
    const updated = normalize(
      {
        ...doc,
        ...((args.data as Record<string, unknown>) || {}),
        ...(docstatus === 1 ? { ti_confirmation_version: args.version } : {}),
      },
      doc.name,
      Number(doc.version) + 1,
      docstatus,
    );
    documents.set(key(doc.doctype, doc.name), updated);
    syncSavedDocument(updated);
    return copy(updated);
  }
  if (endpoint === "native_files.attachments")
    return copy(files.get(key(String(args.doctype), String(args.name))) || []);
  if (endpoint === "native_files.remove_attachment") {
    const list = files.get(key(String(args.doctype), String(args.name))) || [];
    const index = list.findIndex((row) => row.name === args.file_name);
    if (index >= 0) list.splice(index, 1);
    return { deleted: true };
  }
  if (endpoint === "catalog.batch_details") {
    const batch = fixtureBatch(String(args.name));
    if (!batch) throw new Error("原生批次不存在");
    return batch;
  }
  if (endpoint === "catalog.operation_items") {
    const codes = args.item_codes as string[];
    return { items: codes.map(fixtureCatalogItem), errors: [] };
  }
  if (endpoint === "catalog.batch_metadata_many") {
    const result: Record<string, unknown> = {};
    for (const name of args.names as string[]) {
      const batch = fixtureBatch(name);
      if (batch) result[name] = batch;
    }
    return result;
  }
  if (endpoint === "catalog.item_lifecycle")
    return {
      disabled: false,
      tracking_changeable: true,
      tracking_change_reason: "",
      can_delete: true,
    };
  if (endpoint === "catalog.suggest_item_code")
    return { item_code: `ITM-${String(1000 + sequence + 1).padStart(6, "0")}` };
  if (endpoint === "catalog.receipt_batches") {
    const result = (args.rows as Record<string, unknown>[]).map((row) => {
      const name = String(
        row.batch_id || `20261026-${String(++sequence).padStart(3, "0")}`,
      );
      if (!batches.has(name))
        batches.set(name, {
          name,
          item_code: row.item_code,
          expiry_date: row.expiry_date || "",
          manufacturing_date: row.manufacturing_date || "",
        });
      return { local_id: row.local_id, name };
    });
    return { batches: result };
  }
  if (endpoint === "catalog.scan_code") {
    const value = String(args.value),
      matches = reviewSession.stock
        .filter(
          (row) =>
            row.code === value ||
            row.barcode?.split("\n").includes(value) ||
            row.locations.some((place) =>
              place.batches?.some((batch) => batch.id === value),
            ),
        )
        .map((row) => fixtureCatalogItem(row.code));
    const warehouse = reviewSession.warehouses.find(
      (row) => row.name === value,
    );
    return {
      matches,
      barcode: value,
      unknown: !matches.length && !warehouse,
      warehouse: warehouse ? copy(warehouse) : null,
      batches: matches.flatMap(
        (item) =>
          item.stock
            ?.filter((row) => row.batch_no === value)
            .map((row) => row.batch_no) || [],
      ),
    };
  }
  if (endpoint === "catalog.save_item") {
    const data = args.data as Record<string, unknown>,
      previous = reviewSession.stock.find(
        (row) => row.code === (args.item_code || data.item_code),
      );
    if (previous && !args.item_code) throw new Error("物品编号已存在");
    if (previous && String(previous.conversionVersion || 0) !== args.version)
      throw Object.assign(new Error("物品已更改"), {
        kind: "TimestampMismatchError",
      });
    if (!previous)
      reviewSession.stock.push({
        code: String(data.item_code),
        name: String(data.item_name),
        category: String(data.item_group),
        uom: String(data.stock_uom),
        tracksBatch: Boolean(data.has_batch_no),
        tracksExpiry: Boolean(data.has_expiry_date),
        locations: [],
        available: 0,
        loaned: 0,
        damaged: 0,
        illustration: "none",
      });
    const row = reviewSession.stock.find(
      (row) => row.code === String(args.item_code || data.item_code),
    )!;
    Object.assign(row, {
      name: String(data.item_name),
      category: String(data.item_group),
      barcode: String(data.barcodes || ""),
      description: String(data.description || ""),
      conversionVersion: (row.conversionVersion || 0) + 1,
    });
    sequence++;
    return fixtureCatalogItem(row.code);
  }
  if (endpoint === "catalog.set_item_image") {
    const row = reviewSession.stock.find((row) => row.code === args.item_code);
    const file = files
      .get(key("Item", String(args.item_code)))
      ?.find((row) => row.name === args.file_name);
    if (!row || !file) throw new Error("附件不存在");
    row.images = [file.file_url];
    row.conversionVersion = (row.conversionVersion || 0) + 1;
    return fixtureCatalogItem(row.code);
  }
  throw new Error(`图库服务尚未配置：${endpoint}`);
}
export async function fixtureUpload(
  file: File,
  doctype: string,
  name: string,
  progress?: (value: number) => void,
) {
  synchronizeSession();
  progress?.(0);
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const value = {
    name: `GALLERY-FILE-${++sequence}`,
    file_name: file.name,
    file_url: `/private/files/gallery-${sequence}-${encodeURIComponent(file.name)}`,
    file_type: file.name.split(".").at(-1)?.toUpperCase() || "",
    file_size: file.size,
    is_private: 1,
  };
  fileDisplays.set(value.name, url);
  const parent = key(doctype, name),
    list = files.get(parent) || [];
  list.push(value);
  files.set(parent, list);
  progress?.(100);
  return copy(value);
}
