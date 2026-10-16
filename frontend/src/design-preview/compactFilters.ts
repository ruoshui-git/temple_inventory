import { activityLabel } from "./activityData";
import { movementLabels, type BrowseScope } from "./browseModel";
import { reviewSession } from "./reviewModel";

export type ScopeFilterField = Exclude<keyof BrowseScope, "period">;
export const scopeFilterLabels: Record<ScopeFilterField, string> = {
  item: "物品",
  activity: "活动",
  categories: "物品类别",
  warehouses: "仓库 / 位置",
  kinds: "流动类型",
  sources: "来源位置",
  destinations: "去向位置",
};
export function scopeFilterChips(scope: BrowseScope) {
  return (Object.keys(scopeFilterLabels) as ScopeFilterField[]).flatMap(
    (field) => {
      const selected = scope[field];
      const values = Array.isArray(selected)
        ? selected
        : selected
          ? [selected]
          : [];
      return values.map((value) => {
        const name = scopeValueLabel(field, value);
        return {
          key: `${field}:${value}`,
          field,
          value,
          label: `${scopeFilterLabels[field]}：${name}`,
        };
      });
    },
  );
}

function scopeValueLabel(field: ScopeFilterField, value: string) {
  if (field === "activity") return activityLabel(value);
  if (field === "item")
    return reviewSession.stock.find((row) => row.code === value)?.name || value;
  if (field === "kinds") return movementLabels[value] || value;
  if (field === "categories")
    return (
      reviewSession.categories.find((row) => row.name === value)?.label || value
    );
  const label = reviewSession.warehouses.find(
    (row) => row.name === value,
  )?.label;
  return label && label !== value ? `${value}（${label}）` : value;
}
