import { warehouseLabel } from "./warehouseLabel";
import type { BrowseScope } from "./browseQuery";
import type { ReferenceData } from "../services/contracts";
export type ScopeFilterField = Exclude<
  keyof BrowseScope,
  "period" | "uncategorized"
>;
export const movementLabels: Record<string, string> = {
  Receive: "入库",
  Issue: "出库",
  Transfer: "调拨",
  Loan: "借出",
  Return: "归还",
  Damage: "损坏",
  Loss: "遗失",
  Repair: "修复归库",
  Disposal: "报废",
  Opening: "期初库存",
  Reconcile: "库存调整",
};
export const scopeFilterLabels: Record<ScopeFilterField, string> = {
  item: "物品",
  activity: "活动",
  categories: "物品类别",
  warehouses: "仓库 / 位置",
  kinds: "流动类型",
  sources: "来源位置",
  destinations: "去向位置",
};
export function scopeValueLabel(
  field: ScopeFilterField,
  value: string,
  reference: ReferenceData,
) {
  if (field === "activity")
    return (
      reference.activities.find((row) => row.value === value)?.label || value
    );
  if (field === "item")
    return reference.items.find((row) => row.value === value)?.label || value;
  if (field === "kinds") return movementLabels[value] || value;
  if (field === "categories")
    return (
      reference.categories.find((row) => row.name === value)?.label || value
    );
  return warehouseLabel(value, reference.warehouses);
}
export function scopeFilterChips(scope: BrowseScope, reference: ReferenceData) {
  const chips = (Object.keys(scopeFilterLabels) as ScopeFilterField[]).flatMap(
    (field) => {
      const selected = scope[field];
      const values = Array.isArray(selected)
        ? selected
        : selected
          ? [selected]
          : [];
      return values.map((value) => ({
        key: `${field}:${value}`,
        field,
        value,
        label: `${scopeFilterLabels[field]}：${scopeValueLabel(field, value, reference)}`,
      }));
    },
  );
  if (scope.uncategorized)
    chips.push({
      key: "uncategorized",
      field: "categories",
      value: "__uncategorized__",
      label: "物品类别：无分类",
    });
  return chips;
}
