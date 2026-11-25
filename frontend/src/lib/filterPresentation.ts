import type { TooltipValue } from "./tooltip";
import { locationTip, warehouseLabel } from "./warehouseLabel";
import type { BrowseScope } from "./browseQuery";
import { periodLabels } from "./browseQuery";
import type { ReferenceData } from "../services/contracts";
import { movementIcon } from "./kindIcons";
import { movementLabels } from "./presentationLabels";
import { sitePeriodSummary } from "./sitePeriod";
import { unitLabel } from "./units";
export type ScopeFilterField = Exclude<
  keyof BrowseScope,
  "period" | "uncategorized"
>;
const warehouseFields = new Set<ScopeFilterField>([
  "warehouses",
  "sources",
  "destinations",
]);
const scopeFilterLabels: Record<ScopeFilterField, string> = {
  item: "物品",
  activity: "活动",
  categories: "物品类别",
  units: "单位",
  warehouses: "仓库 / 位置",
  kinds: "流动类型",
  sources: "来源位置",
  destinations: "去向位置",
  tracking: "物品追踪",
};
export function warehouseFilterTip(
  values: readonly string[],
  reference: ReferenceData,
) {
  const tips = [...new Set(values)]
    .map((value) => locationTip(value, reference.warehouses))
    .filter((tip) => tip !== undefined);
  if (tips.length < 2) return tips[0];
  return tips
    .map((tip) =>
      typeof tip === "string"
        ? tip
        : tip.location.levels
            .map(({ code, name }) => [code, name].filter(Boolean).join(" "))
            .join(" › "),
    )
    .join("\n");
}
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
  if (field === "units")
    return (
      reference.units.find((unit) => unit.name === value)?.label ||
      unitLabel(value)
    );
  if (field === "tracking")
    return (
      (
        {
          batch: "按批次管理",
          serial: "按序列号管理",
          expiry: "记录效期",
          none: "不追踪",
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
      return values.map((value) => {
        const tip = warehouseFields.has(field)
          ? locationTip(value, reference.warehouses)
          : undefined;
        return {
          key: `${field}:${value}`,
          field,
          value,
          label: `${scopeFilterLabels[field]}：${scopeValueLabel(field, value, reference)}`,
          icon: field === "kinds" ? movementIcon(String(value)) : undefined,
          ...(tip ? { tip } : {}),
        };
      });
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

/**
 * Compact toolbar chips summarize each field; individual values stay editable in the filter form.
 * A date chip shows whenever the period restricts rows, including the page's default period;
 * 全部时间 is unrestricted and has no chip.
 */
export function scopeFilterFieldChips(
  scope: BrowseScope,
  reference?: ReferenceData,
) {
  const chips: Array<{
    key: string;
    field: ScopeFilterField | "period";
    label: string;
    icon?: string;
    tip?: TooltipValue;
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
      const tip =
        reference && warehouseFields.has(field)
          ? warehouseFilterTip(values, reference)
          : undefined;
      return [
        {
          key: `field:${field}`,
          field,
          ...(tip ? { tip } : {}),
          label: `${scopeFilterLabels[field]}：${visible.join("、")}${remaining ? ` + ${remaining} 项` : ""}`,
          ...(field === "kinds" && values.length === 1
            ? { icon: movementIcon(String(values[0])) }
            : {}),
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

/** Removing a chip lifts its restriction: a date chip returns to 全部时间, not the page default. */
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
