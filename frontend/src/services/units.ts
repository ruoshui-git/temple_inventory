import type { InventoryServices, ReferenceData } from "./contracts";

export interface UnitRow {
  name: string;
  label: string;
  category: string;
  must_be_whole_number: boolean;
  enabled: boolean;
  item_count: number;
  conversion_count: number;
  used_in_transactions: boolean;
  deletable: boolean;
  delete_reason: string;
}

export function listUnits(services: InventoryServices) {
  return services.call<UnitRow[]>("units.list_units");
}

export function saveUnit(
  services: InventoryServices,
  values: {
    name?: string;
    uom_name?: string;
    label: string;
    must_be_whole_number: boolean;
    category?: string;
    enabled?: boolean;
  },
) {
  return services.call<UnitRow>("units.save_unit", values);
}

export function deleteUnit(services: InventoryServices, name: string) {
  return services.call<{ name: string; deleted: boolean }>(
    "units.delete_unit",
    {
      name,
    },
  );
}

export async function refreshUnitReference(
  services: InventoryServices,
  reference: ReferenceData,
) {
  const result = await services.call<{
    uoms: {
      name: string;
      label: string;
      must_be_whole_number: boolean;
      category: string | null;
      enabled: boolean;
    }[];
  }>("browse.bootstrap");
  reference.units.splice(
    0,
    reference.units.length,
    ...result.uoms.map((row) => ({
      name: row.name,
      label: row.label || row.name,
      whole: Boolean(row.must_be_whole_number),
      category: row.category,
      enabled: Boolean(row.enabled),
    })),
  );
}

export function listUnitCategories(services: InventoryServices) {
  return services.call<{ name: string }[]>("units.list_categories");
}

export function createUnitCategory(
  services: InventoryServices,
  category_name: string,
) {
  return services.call<{ name: string }>("units.create_category", {
    category_name,
  });
}
