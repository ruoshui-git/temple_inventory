import type { LocationQuery, LocationQueryRaw } from "vue-router";

export interface BrowseContextItem {
  key: string;
  label: string;
  path: string;
  query: LocationQueryRaw;
}

export function movementBrowseContext(
  query: LocationQuery,
): BrowseContextItem[] {
  const sharedQuery = { ...query };
  return [
    {
      key: "items",
      label: "明细",
      path: "/movements/items",
      query: sharedQuery,
    },
    {
      key: "records",
      label: "记录",
      path: "/movements/records",
      query: sharedQuery,
    },
  ];
}

export function loanBrowseContext(
  path: string,
  query: LocationQuery,
): BrowseContextItem[] {
  const current = path === "/loans/records" ? "records" : "items";
  return (["items", "records"] as const).map((target) => {
    const targetQuery: LocationQueryRaw = { ...query };
    if (target !== current) {
      delete targetQuery.status;
      delete targetQuery.outcome;
      delete targetQuery.sort_by;
      delete targetQuery.sort_order;
    }
    return {
      key: target,
      label: target === "items" ? "明细" : "记录",
      path: `/loans/${target}`,
      query: targetQuery,
    };
  });
}
