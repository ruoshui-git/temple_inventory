export const periodLabels = {
  all: "全部时间",
  today: "今日",
  this_week: "本周",
  this_month: "本月",
  this_year: "本年",
  this_quarter: "本季度",
  last_quarter: "上季度",
  q1: "第1季度",
  q2: "第2季度",
  q3: "第3季度",
  q4: "第4季度",
  last_year: "去年",
  last_7_days: "近7天",
  last_30_days: "近30天",
  last_90_days: "近90天",
  last_365_days: "近365天",
  custom: "自定义",
};
export type PeriodKey = keyof typeof periodLabels;
export interface DatePeriod {
  key: PeriodKey;
  from: string;
  to: string;
}
export interface BrowseScope {
  period: DatePeriod;
  warehouses: string[];
  categories: string[];
  uncategorized: boolean;
  item: string;
  activity: string;
  sources: string[];
  destinations: string[];
  kinds: string[];
  tracking: "all" | "batch" | "expiry" | "none" | "batch_only";
}
export const emptyScope = (): BrowseScope => ({
  period: { key: "all", from: "", to: "" },
  warehouses: [],
  categories: [],
  uncategorized: false,
  item: "",
  activity: "",
  sources: [],
  destinations: [],
  kinds: [],
  tracking: "all",
});
