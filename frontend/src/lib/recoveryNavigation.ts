import type { RecoverySnapshot } from "./browserRecovery";
import { documentDestination, operationDestination } from "./nativeNavigation";
import { routeTarget } from "./routeRegistry";
import { operationLabels } from "./presentationLabels";

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
      return operationDestination(kind, query);
  }
  if (entry.editorKind === "Stock Reconciliation")
    return entry.identity?.doctype === "Stock Reconciliation"
      ? { ...routeTarget("count-detail", { name: entry.identity.name }), query }
      : { ...routeTarget("count-new"), query };
  if (entry.editorKind === "Item") {
    const code = String(entry.values.editingCode || "");
    return code
      ? { ...routeTarget("item-edit", { code }), query }
      : { ...routeTarget("item-new"), query };
  }
  if (entry.editorKind === "Inventory Activity") {
    const name = String(entry.values.editingActivity || "");
    return name
      ? { ...routeTarget("activity-edit", { name }), query }
      : { ...routeTarget("activity-new"), query };
  }
  if (entry.editorKind === "Warehouse")
    return {
      ...routeTarget("warehouses"),
      query: { ...query, edit: String(entry.values.editingWarehouse || "") },
    };
}
