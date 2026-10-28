import { warehouseLabel } from "./warehouseLabel";
import type { BrowseScope } from "./browseQuery";
import { periodLabels } from "./browseQuery";
import type { ReferenceData } from "../services/contracts";
import { movementIcon, movementLabels } from "./kindIcons";
import { sitePeriodSummary } from "./sitePeriod";
export { movementLabels } from "./kindIcons";
export type ScopeFilterField = Exclude<
  keyof BrowseScope,
  "period" | "uncategorized"
>;
export const scopeFilterLabels: Record<ScopeFilterField, string> = {
  item: "物品",
  activity: "活动",
  categories: "物品类别",
  warehouses: "仓库 / 位置",
  kinds: "流动类型",
  sources: "来源位置",
  destinations: "去向位置",
  tracking: "物品追踪",
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
  if (field === "kinds")
    return value ? movementLabels[value] || "其他类型" : "";
  if (field === "categories")
    return (
      reference.categories.find((row) => row.name === value)?.label || value
    );
  if (field === "tracking")
    return (
      (
        {
          batch: "按批次管理",
          expiry: "记录效期",
          none: "不按批次管理",
          batch_only: "仅批次（不记录效期）",
        } as Record<string, string>
      )[value] || value
    );
  return warehouseLabel(value, reference.warehouses, value);
}
export function scopeFilterChips(scope: BrowseScope, reference: ReferenceData) {
  const chips = (Object.keys(scopeFilterLabels) as ScopeFilterField[]).flatMap(
    (field) => {
      const selected = scope[field];
      const values =
        field === "tracking" && selected === "all"
          ? []
          : Array.isArray(selected)
            ? selected
            : selected
              ? [selected]
              : [];
      return values.map((value) => ({
        key: `${field}:${value}`,
        field,
        value,
        label: `${scopeFilterLabels[field]}：${scopeValueLabel(field, value, reference)}`,
        icon: field === "kinds" ? movementIcon(String(value)) : undefined,
      }));
    },
  );
  if (scope.uncategorized)
    chips.push({
      key: "uncategorized",
      field: "categories",
      value: "__uncategorized__",
      label: "物品类别：无分类",
      icon: undefined,
    });
  return chips;
}

/** Compact toolbar chips summarize each field; individual values stay editable in the filter form. */
export function scopeFilterFieldChips(
  scope: BrowseScope,
  reference?: ReferenceData,
) {
  const chips: Array<{
    key: string;
    field: ScopeFilterField | "period";
    label: string;
    icon?: string;
  }> = (Object.keys(scopeFilterLabels) as ScopeFilterField[]).flatMap(
    (field) => {
      const selected = scope[field];
      const values =
        field === "tracking" && selected === "all"
          ? []
          : Array.isArray(selected)
            ? [...selected]
            : selected
              ? [selected]
              : [];
      if (field === "categories" && scope.uncategorized)
        values.push("__uncategorized__");
      if (!values.length) return [];
      const visible = values
        .slice(0, 2)
        .map((value) =>
          value === "__uncategorized__"
            ? "无分类"
            : field === "tracking"
              ? scopeValueLabel(field, value, reference as ReferenceData)
              : reference
                ? scopeValueLabel(field, value, reference)
                : value,
        );
      const remaining = values.length - visible.length;
      return [
        {
          key: `field:${field}`,
          field,
          label: `${scopeFilterLabels[field]}：${visible.join("、")}${remaining ? ` + ${remaining} 项` : ""}`,
          icon:
            field === "kinds" && values.length === 1
              ? movementIcon(String(values[0]))
              : undefined,
        },
      ];
    },
  );
  if (scope.period.key !== "all") {
    const value = reference
      ? sitePeriodSummary(scope.period, reference.siteDate)
      : scope.period.key === "custom"
        ? [scope.period.from, scope.period.to].filter(Boolean).join(" – ") ||
          "日期待补全"
        : periodLabels[scope.period.key];
    chips.push({
      key: "field:period",
      field: "period",
      label: `日期：${value}`,
    });
  }
  return chips;
}

export function clearScopeField(
  scope: BrowseScope,
  field: ScopeFilterField | "period",
) {
  if (field === "period") {
    scope.period = { key: "all", from: "", to: "" };
    return;
  }
  if (field === "tracking") {
    scope.tracking = "all";
    return;
  }
  const value = scope[field];
  Object.assign(scope, { [field]: Array.isArray(value) ? [] : "" });
  if (field === "categories") scope.uncategorized = false;
}
