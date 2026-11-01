import type { InventoryServices, ReferenceData } from "./contracts";

export interface ActivityTypeRow {
  name: string;
  label: string;
  enabled: boolean;
  display_order: number;
  activity_count: number;
  deletable: boolean;
  delete_reason: string;
}

export const listActivityTypes = (services: InventoryServices) =>
  services.call<ActivityTypeRow[]>("activities.list_activity_types");
export const saveActivityType = (
  services: InventoryServices,
  values: { name?: string; label: string; enabled: boolean },
) => services.call<ActivityTypeRow>("activities.save_activity_type", values);
export const deleteActivityType = (services: InventoryServices, name: string) =>
  services.call<{ name: string; deleted: boolean }>(
    "activities.delete_activity_type",
    { name },
  );
export const reorderActivityTypes = (
  services: InventoryServices,
  names: string[],
) =>
  services.call<ActivityTypeRow[]>("activities.reorder_activity_types", {
    names,
  });
export async function refreshActivityTypeReference(
  services: InventoryServices,
  reference: ReferenceData,
) {
  const result = await listActivityTypes(services);
  reference.activityTypes.splice(
    0,
    reference.activityTypes.length,
    ...result
      .filter((row) => row.enabled)
      .map((row) => ({ name: row.name, value: row.name, label: row.label })),
  );
}
