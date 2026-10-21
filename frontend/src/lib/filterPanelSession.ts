import type { InjectionKey } from "vue";

export const filterPanelSessionKey: InjectionKey<string> = Symbol(
  "filter-panel-session",
);
export const browseHierarchyEditKey: InjectionKey<
  (field: "categories" | "warehouses") => void
> = Symbol("browse-hierarchy-edit");
