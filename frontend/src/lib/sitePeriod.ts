import { periodLabels, type DatePeriod } from "./browseQuery";

export { periodLabels, type DatePeriod };
/** The caller provides the Frappe site's date; no browser timezone/fixture clock. */
export function resolveSitePeriod(period: DatePeriod, today: string) {
  if (period.key === "all") return { from: "", to: "" };
  if (period.key === "custom") return { from: period.from, to: period.to };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return { from: "", to: "" };
  const date = new Date(`${today}T00:00:00Z`);
  const start = new Date(date);
  const end = new Date(date);
  const rolling = /^last_(\d+)_days$/.exec(period.key);
  if (rolling) start.setUTCDate(start.getUTCDate() - Number(rolling[1]) + 1);
  if (period.key === "this_week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period.key === "this_month") start.setUTCDate(1);
  if (period.key === "this_year") start.setUTCMonth(0, 1);
  if (period.key === "this_quarter") {
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
  }
  if (period.key === "last_quarter") {
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3 - 3, 1);
    end.setTime(start.getTime());
    end.setUTCMonth(start.getUTCMonth() + 3, 0);
  }
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
