import type { ReportQuery } from "./reportContract";
import type { LocationQueryRaw } from "vue-router";
import {
  browseRouteTarget,
  nativeDocumentTarget,
  routeTarget,
  serializeBrowseQuery,
} from "./routeRegistry";

export const documentDestination = nativeDocumentTarget;

export function loanDestination(name: string, back: string) {
  return routeTarget("loan-overview", { name }, { back });
}

export function exportDestination(query: ReportQuery) {
  return routeTarget("reports", {}, { query: JSON.stringify(query) });
}

export function browseDestination(query: ReportQuery) {
  return browseRouteTarget(query);
}

export function operationDestination(
  kind: string,
  query: LocationQueryRaw = {},
) {
  return routeTarget("movement-new", { kind }, query);
}

export function countDestination(query: LocationQueryRaw = {}) {
  return routeTarget("count-new", {}, query);
}

export function browseStateDestination(
  family: "movements" | "loans",
  view: "items" | "records",
  query: ReportQuery,
) {
  const name = family === "movements" ? "movements" : "loans";
  return routeTarget(name, {}, { view, query: serializeBrowseQuery(query) });
}
