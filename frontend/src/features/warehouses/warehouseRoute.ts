import type { RouteLocationNormalized } from "vue-router";

// The manager mirrors its own selection and search into the query; those writes never leave the
// page, so they must not ask an open editor to confirm leaving.
const browseStateKeys = new Set(["warehouse", "search"]);

export function isBrowseStateUpdate(
  to: Pick<RouteLocationNormalized, "path" | "query">,
  from: Pick<RouteLocationNormalized, "path" | "query">,
): boolean {
  if (to.path !== from.path) return false;
  const keys = new Set([...Object.keys(to.query), ...Object.keys(from.query)]);
  return [...keys].every(
    (key) =>
      browseStateKeys.has(key) ||
      JSON.stringify(to.query[key]) === JSON.stringify(from.query[key]),
  );
}
