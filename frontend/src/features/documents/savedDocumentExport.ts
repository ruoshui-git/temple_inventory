import { newReportQuery } from "../../lib/reportContract";
import type { NativeDocument } from "./nativeEditor";

/** Export only the persisted snapshot; local input never contributes to scope. */
export function savedDocumentExport(
  doc: NativeDocument | undefined,
  status: string,
) {
  if (!doc || ["deleted", "forbidden"].includes(status)) return undefined;
  if (!["Stock Entry", "Stock Reconciliation"].includes(doc.doctype))
    return undefined;
  const query = newReportQuery(
    doc.doctype === "Stock Entry" ? "movements" : "counts",
  );
  query.view = "records";
  query.record = doc.name;
  query.recordDoctype = doc.doctype;
  query.statuses = [doc.docstatus];
  return query;
}
