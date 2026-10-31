import {
  newReportQuery,
  type ReportDataset,
  type ReportQuery,
} from "./reportContract";
import { defaultPeriods } from "./uiPreferences";

export type BrowseDefaultMode = "browse" | "drafts";

/** The canonical initial/reset state for each URL-backed browse surface. */
export function browseDefaults(
  dataset: ReportDataset,
  view?: string,
  mode: BrowseDefaultMode = "browse",
): ReportQuery {
  const query = newReportQuery(dataset);
  if (view) query.view = view;

  if (
    dataset === "loans" ||
    dataset === "counts" ||
    (dataset === "movements" && mode === "browse")
  )
    query.scope.period = {
      key: defaultPeriods.value[dataset],
      from: "",
      to: "",
    };

  if (dataset === "inventory") {
    if (query.view === "summary" || query.view === "locations") {
      query.sortBy = "item_name";
      query.sort = "asc";
    }
  } else if (dataset === "expiry") {
    query.sortBy = "expiry_date";
  } else if (dataset === "movements") {
    if (query.view === "records") {
      query.sortBy = mode === "drafts" ? "modified" : "date";
      query.sort = "desc";
      if (mode === "drafts") query.statuses = [0];
    } else {
      query.sortBy = "item_name";
      query.sort = "asc";
    }
  } else if (dataset === "loans") {
    query.sortBy = query.view === "records" ? "date" : "item_name";
    query.sort = query.view === "records" ? "desc" : "asc";
    if (query.view === "items") {
      query.loanOutcome = "all";
      query.outstandingOnly = false;
      query.statuses = [1];
    }
  } else if (dataset === "activities") {
    query.sortBy = query.view === "metadata" ? "modified" : "identity";
    query.sort = query.view === "metadata" ? "desc" : "asc";
  } else if (dataset === "counts" && query.view === "records") {
    query.sortBy = "date";
    query.sort = "desc";
    query.statuses = [0, 1, 2];
  }

  return query;
}

/** Link-provided constraints: the panel's 恢复默认 keeps them, and their own chips remove them. */
export const linkedConstraintFields = [
  "restrictItems",
  "itemCodes",
  "itemLocationKeys",
  "restrictAllocations",
  "allocationKeys",
  "loan",
  "record",
  "recordDoctype",
  "batchNo",
] as const satisfies readonly (keyof ReportQuery)[];

/** Search and presentation keep their own controls, so they never make filters differ from defaults. */
const presentationFields = ["search", "sort", "sortBy", "view"] as const;

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : item,
  );
}

/** True when every filter field (scope, chips, grouping) equals the page default. */
export function filtersAtDefaults(
  query: ReportQuery,
  defaults: ReportQuery,
  ignore: readonly (keyof ReportQuery)[] = [],
) {
  const skip = new Set<string>([...presentationFields, ...ignore]);
  const comparable = (value: ReportQuery) =>
    canonicalJson(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => !skip.has(key)),
      ),
    );
  return comparable(query) === comparable(defaults);
}
