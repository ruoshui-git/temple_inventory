import type { InventoryServices } from "../../services/contracts";

export async function markExportWatched(
  services: Pick<InventoryServices, "call">,
  name: string,
) {
  await services.call("exports.mark_watched", { name });
  window.dispatchEvent(new Event("inventory-notification-refresh"));
}
