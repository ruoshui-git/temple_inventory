export interface InventoryAttachment {
  id: string; name: string; type: string; url?: string;
  state: "uploading" | "ready" | "error"; progress?: number;
}
export interface StockBatch { id: string; available: number; loaned?: number; damaged?: number; expiry?: string; manufacturingDate?: string }
export interface StockLocation { location: string; label?: string; available: number; loaned: number; damaged: number; batches?: StockBatch[] }
export interface StockItem {
  code: string; name: string; category: string; uom: string; image?: string; description?: string; barcode?: string;
  tracksBatch: boolean; tracksExpiry: boolean; locations: StockLocation[];
  available: number; loaned: number; damaged: number;
  alternateUnits?: { uom: string; factor: number }[];
  files?: InventoryAttachment[]; version?: string; canEdit?: boolean;
}
export function itemBatches(item: StockItem) {
  const result = new Map<string, StockBatch>();
  for (const location of item.locations) for (const batch of location.batches || []) {
    const current = result.get(batch.id);
    if (current) { current.available += batch.available; current.loaned = (current.loaned || 0) + (batch.loaned || 0); current.damaged = (current.damaged || 0) + (batch.damaged || 0); }
    else result.set(batch.id, { ...batch });
  }
  return [...result.values()];
}
export function expiryStatus(item: StockItem, today: string) {
  if (!item.tracksExpiry) return null;
  const dates = itemBatches(item).flatMap((batch) => batch.expiry ? [batch.expiry] : []).sort();
  return dates.length ? dates[0]! < today ? "已过期" : "未过期" : null;
}
