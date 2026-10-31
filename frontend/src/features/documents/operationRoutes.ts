import type { LocationQuery, RouteLocationRaw } from "vue-router";

export function duplicateOperationTarget(
  priorName: string | undefined,
  newName: string | undefined,
  query: LocationQuery,
): RouteLocationRaw | undefined {
  if (!priorName || !newName || priorName === newName) return undefined;
  return { name: "movement-detail", params: { name: newName }, query };
}
