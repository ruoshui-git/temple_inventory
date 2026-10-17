import { emptyScope, periodLabels, type DatePeriod } from "./browseQuery";
import {
  newReportQuery,
  reportDefinitions,
  type ReportDataset,
  type ReportQuery,
} from "./reportContract";
const own = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000)
    throw new Error("筛选文字无效或过长");
  return value;
}
function strings(value: unknown) {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error("筛选范围无效");
  return [...new Set(value.map(text))];
}
function period(value: unknown): DatePeriod {
  if (
    !record(value) ||
    typeof value.key !== "string" ||
    !own(periodLabels, value.key)
  )
    throw new Error("日期范围无效");
  const result = {
    key: value.key,
    from: value.from === undefined ? "" : text(value.from),
    to: value.to === undefined ? "" : text(value.to),
  } as DatePeriod;
  const date = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (
    result.key === "custom" &&
    (!date(result.from) || !date(result.to) || result.from > result.to)
  )
    throw new Error("请填写有效的完整日期范围");
  return result;
}

/** Mirrors the server's canonical scope without widening malformed URL restrictions. */
export function decodeReportQuery(
  value: unknown,
  fallback: ReportDataset = "inventory",
): { query: ReportQuery; error: string } {
  if (value === undefined || value === null || value === "")
    return { query: newReportQuery(fallback), error: "" };
  try {
    const candidate: unknown =
      typeof value === "string" ? JSON.parse(value) : value;
    if (!record(candidate)) throw new Error("导出设置无效");
    const dataset =
      candidate.dataset === undefined ? fallback : candidate.dataset;
    if (typeof dataset !== "string" || !own(reportDefinitions, dataset))
      throw new Error("数据集无效");
    const query = newReportQuery(dataset as ReportDataset);
    const target = query as unknown as Record<string, unknown>;
    for (const [field, initial] of Object.entries(query)) {
      if (
        !own(candidate, field) ||
        ["dataset", "view", "scope"].includes(field)
      )
        continue;
      const actual = candidate[field];
      if (typeof initial === "boolean") {
        if (typeof actual !== "boolean") throw new Error("筛选值必须为是或否");
        target[field] = actual;
      } else if (typeof initial === "string") target[field] = text(actual);
      else if (field === "statuses") {
        if (
          !Array.isArray(actual) ||
          actual.some(
            (status) =>
              !Number.isInteger(status) || ![0, 1, 2].includes(status),
          )
        )
          throw new Error("单据状态无效");
        target[field] = [...new Set(actual)];
      } else if (Array.isArray(initial)) target[field] = strings(actual);
      else target[field] = period(actual);
    }
    if (own(candidate, "view")) query.view = text(candidate.view);
    const definition = reportDefinitions[query.dataset];
    if (
      !definition.views.some((view) => view.id === query.view) ||
      !["none", ...definition.groups].includes(query.grouping)
    )
      throw new Error("此数据集不支持所选视图或分组");
    const enums: Partial<Record<keyof ReportQuery, readonly string[]>> = {
      sort: ["asc", "desc"],
      sortBy: ["identity", "date", "modified", "quantity", "name"],
      activityStatus: ["all", "active", "archived"],
      loanStatus: ["all", "outstanding", "open", "settled"],
      loanOutcome: ["all", "outstanding", "returned", "damaged", "lost"],
      countReviewed: [
        "all",
        "reviewed",
        "unreviewed",
        "difference",
        "not-found",
      ],
      relatedPresence: ["all", "yes", "no", "with", "without"],
      expiryWindow: [
        "period",
        "expired",
        "unexpired",
        "undated",
        "next_7",
        "next_30",
        "next_90",
        "next_365",
      ],
    };
    for (const [field, allowed] of Object.entries(enums))
      if (!allowed!.includes(String(target[field])))
        throw new Error("筛选值无效");
    if (own(candidate, "scope")) {
      if (!record(candidate.scope)) throw new Error("筛选范围无效");
      const scope = query.scope as unknown as Record<string, unknown>;
      for (const [field, initial] of Object.entries(emptyScope())) {
        if (!own(candidate.scope, field)) continue;
        scope[field] =
          field === "period"
            ? period(candidate.scope[field])
            : Array.isArray(initial)
              ? strings(candidate.scope[field])
              : text(candidate.scope[field]);
      }
    }
    if (
      query.dataset === "inventory" &&
      query.view === "historical" &&
      query.scope.period.key === "all"
    )
      throw new Error("历史数量余额需要有起止日期的范围");
    return { query, error: "" };
  } catch (reason) {
    const query = newReportQuery(fallback);
    query.restrictItems = true;
    query.itemCodes = [];
    return {
      query,
      error: `链接中的筛选设置无效：${reason instanceof Error ? reason.message : "无法读取"}。请清除限制或重新选择范围。`,
    };
  }
}
export const readReportQuery = (
  value: unknown,
  fallback: ReportDataset = "inventory",
) => decodeReportQuery(value, fallback).query;
