import {
  newReportQuery,
  type ReportDataset,
  type ReportQuery,
} from "./reportContract";

export type BrowseDefaultMode = "browse" | "drafts";

/** The canonical initial/reset state for each URL-backed browse surface. */
export function browseDefaults(
  dataset: ReportDataset,
  view?: string,
  mode: BrowseDefaultMode = "browse",
): ReportQuery {
  const query = newReportQuery(dataset);
  if (view) query.view = view;

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
