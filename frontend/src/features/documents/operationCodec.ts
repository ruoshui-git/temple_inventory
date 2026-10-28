import { postingTime } from "../../lib/nativeTime";
import { allocationDestination } from "./operationModel";
import type { NativeDocument } from "./nativeEditor";
import type {
  AllocationLine,
  OperationDraft,
  OperationKind,
} from "./operationModel";
import type { ReferenceData } from "../../services/contracts";
export function newOperation(
  kind: OperationKind,
  reference: ReferenceData,
): OperationDraft {
  return {
    name: "",
    kind,
    status: "draft",
    postingDate: reference.siteDate,
    postingTime: reference.siteTime.split(" ")[1] || "00:00:00",
    timeMode: "current",
    activity: "",
    borrower: "",
    note: "",
    source: "",
    purpose: "",
    recorder: "",
    handler: "",
    reviewer: "",
    loanName: "",
    loanDestination:
      reference.leasedLeaves.length === 1 ? reference.leasedLeaves[0]! : "",
    items: [],
  };
}
export interface NativeOperationDocument
  extends NativeDocument, OperationDraft {
  items: AllocationLine[];
}
export function decodeOperation(doc: NativeDocument): NativeOperationDocument {
  const kind = String(doc.kind || "") as OperationKind;
  const items: AllocationLine[] = doc.items.map((row) => {
    const id = String(row.name || crypto.randomUUID());
    return {
      nativeFields: { ...row },
      id,
      localId: id,
      name: row.name ? String(row.name) : undefined,
      code: String(row.item_code),
      displayName: String(row.ti_display_item_name || row.item_name || ""),
      displayImage: String(row.ti_display_image || ""),
      displayTracksBatch: Boolean(row.ti_display_tracks_batch),
      displayTracksExpiry: Boolean(row.ti_display_tracks_expiry),
      qty: Number(
        row.transfer_qty ?? Number(row.qty) * Number(row.conversion_factor),
      ),
      uom: String(row.stock_uom || row.uom),
      entryQty: Number(row.qty),
      entryUom: String(row.uom),
      conversionFactor: Number(row.conversion_factor),
      sourceLocation: String(row.s_warehouse || ""),
      loanedLocation:
        kind === "Loan" ? String(row.t_warehouse || "") : undefined,
      location: String(row.t_warehouse || row.s_warehouse || ""),
      batch: String(row.batch_no || ""),
      nativeBundle: String(row.serial_and_batch_bundle || ""),
      recordedBundle: String(row.recorded_bundle || ""),
      batchAllocations: (
        (row.recorded_batch_allocations || []) as Record<string, unknown>[]
      ).map((allocation) => ({
        name: String(allocation.name || ""),
        batch: String(allocation.batch_no || ""),
        qty: Number(allocation.stock_qty),
        expiry: String(allocation.expiry_date || ""),
        manufacturingDate: String(allocation.manufacturing_date || ""),
      })),
      loanName: String(row.ti_original_loan || ""),
      originalLoanLine: String(row.ti_original_loan_line || ""),
      returnOutcome:
        row.ti_settlement_outcome === "Damaged"
          ? "damaged"
          : row.ti_settlement_outcome === "Lost"
            ? "lost"
            : row.ti_settlement_outcome === "Returned"
              ? "returned"
              : undefined,
      reason: String(row.ti_allocation_note || ""),
    };
  });
  return {
    ...doc,
    kind,
    status:
      doc.docstatus === 1
        ? "completed"
        : doc.docstatus === 2
          ? "cancelled"
          : "draft",
    postingDate: String(doc.posting_date),
    postingTime: postingTime(doc.posting_time),
    timeMode: doc.ti_time_mode === "Current" ? "current" : "manual",
    activity: String(doc.ti_activity || ""),
    borrower: String(doc.ti_borrower || ""),
    source: String(doc.ti_source_text || ""),
    purpose: String(doc.ti_purpose_text || ""),
    note: String(doc.remarks || ""),
    recorder: String(doc.ti_recorder_name || ""),
    handler: String(doc.ti_handler_name || ""),
    reviewer: String(doc.ti_reviewer_name || ""),
    loanName: items.find((line) => line.loanName)?.loanName || "",
    loanDestination: String(doc.items[0]?.t_warehouse || ""),
    amendedFrom: String(doc.amended_from || ""),
    items,
  };
}
export function encodeOperation(
  draft: OperationDraft,
  reference: ReferenceData,
): Record<string, unknown> {
  return {
    company: reference.company,
    ti_movement_kind: draft.kind,
    ti_time_mode: draft.timeMode === "current" ? "Current" : "Manual",
    posting_date: draft.postingDate,
    posting_time: draft.postingTime,
    ti_source_text: draft.source,
    ti_purpose_text: draft.purpose,
    ti_activity: draft.activity || null,
    ti_borrower: draft.borrower,
    ti_recorder_name: draft.recorder,
    ti_handler_name: draft.handler,
    ti_reviewer_name: draft.reviewer,
    remarks: draft.note,
    items: draft.items.map((line) => {
      const nativeFields = { ...(line.nativeFields || {}) };
      // These catalog display snapshots are refreshed from the current Item
      // presentation and must not survive unrelated edits as stale values.
      delete nativeFields.ti_display_item_name;
      delete nativeFields.ti_display_image;
      delete nativeFields.ti_display_tracks_batch;
      delete nativeFields.ti_display_tracks_expiry;
      return {
        ...nativeFields,
        ...(line.name ? { name: line.name } : {}),
        item_code: line.code,
        qty: line.entryQty,
        uom: line.entryUom,
        conversion_factor: line.conversionFactor,
        s_warehouse:
          draft.kind === "Receive"
            ? null
            : line.sourceLocation || line.location,
        t_warehouse:
          allocationDestination(draft, line, reference.damagedLeaves) || null,
        batch_no: line.batch || null,
        serial_and_batch_bundle: line.nativeBundle || null,
        use_serial_batch_fields: line.nativeBundle ? 0 : 1,
        ti_original_loan: line.loanName || null,
        ti_original_loan_line: line.originalLoanLine || null,
        ti_settlement_outcome: line.loanName
          ? draft.kind === "Loss"
            ? "Lost"
            : draft.kind === "Damage" || line.returnOutcome === "damaged"
              ? "Damaged"
              : "Returned"
          : null,
        ti_allocation_note: line.reason || "",
      };
    }),
  };
}
