import type { ReportQuery } from "./reportContract";
import type { LocationQueryRaw } from "vue-router";
import {
  browseRouteTarget,
  nativeDocumentTarget,
  routeTarget,
  serializeReportRouteQuery,
  serializeBrowseQuery,
} from "./routeRegistry";

export const documentDestination = nativeDocumentTarget;

export function loanDestination(name: string, back: string) {
  return routeTarget("loan-overview", { name }, { back });
}

export function exportDestination(query: ReportQuery) {
  return routeTarget(
    "reports",
    {},
    { query: serializeReportRouteQuery(query) },
  );
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
  const encoded = serializeBrowseQuery(query);
  return routeTarget(
    name,
    {},
    { view, ...(encoded ? { query: encoded } : {}) },
  );
}
