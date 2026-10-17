import type { RecoverySnapshot } from "./browserRecovery";
import { documentDestination } from "./nativeNavigation";
import { operationLabels } from "../features/documents/operationCodec";
export function recoveryDestination(entry: RecoverySnapshot) {
  const query = { recovery: entry.editorId, editor: crypto.randomUUID() };
  if (entry.editorKind === "Stock Entry") {
    if (entry.identity?.doctype === "Stock Entry")
      return {
        ...documentDestination(entry.identity.doctype, entry.identity.name),
        query,
      };
    const kind = String(entry.values.kind || "");
    if (Object.hasOwn(operationLabels, kind))
      return { path: `/new/${kind}`, query };
  }
  if (entry.editorKind === "Stock Reconciliation")
    return {
      path:
        entry.identity?.doctype === "Stock Reconciliation"
          ? `/reconcile/${encodeURIComponent(entry.identity.name)}`
          : "/reconcile/new",
      query,
    };
  if (entry.editorKind === "Item") {
    const code = String(entry.values.editingCode || "");
    return {
      path: code ? `/item/${encodeURIComponent(code)}/edit` : "/items/new",
      query,
    };
  }
  if (entry.editorKind === "Inventory Activity") {
    const name = String(entry.values.editingActivity || "");
    return {
      path: name
        ? `/activities/${encodeURIComponent(name)}/edit`
        : "/activities/new",
      query,
    };
  }
  if (entry.editorKind === "Warehouse")
    return {
      path: "/warehouses",
      query: { ...query, edit: String(entry.values.editingWarehouse || "") },
    };
}
