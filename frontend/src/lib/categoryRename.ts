export interface CategoryRename {
  oldName: string;
  category: {
    name: string;
    label?: string;
    parent?: string;
    is_group?: boolean;
    version?: string;
  };
}

export function onCategoryRenamed(handler: (change: CategoryRename) => void) {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<CategoryRename>).detail;
    if (detail?.oldName && detail.category?.name) handler(detail);
  };
  window.addEventListener("inventory-category-renamed", listener);
  return () =>
    window.removeEventListener("inventory-category-renamed", listener);
}
