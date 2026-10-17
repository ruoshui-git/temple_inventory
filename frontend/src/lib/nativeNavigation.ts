import type { ReportQuery } from "./reportContract";
export function documentDestination(doctype: string, name: string) {
  return {
    path: `/documents/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
  };
}
export function exportDestination(query: ReportQuery) {
  return { path: "/reports", query: { query: JSON.stringify(query) } };
}
export function browseDestination(query: ReportQuery) {
  if (query.dataset === "inventory" && query.view === "historical")
    return exportDestination(query);
  const path = {
    inventory: "/stock",
    expiry: "/expiry",
    movements: "/movements/records",
    loans: "/loans/records",
    activities: "/activities",
    counts: "/counts",
  }[query.dataset];
  return { path, query: { query: JSON.stringify(query) } };
}
