import type { StockItem } from "./stockPresentation";
import type { ReportRow } from "./reportContract";
export interface NativeFile {
  name: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size?: number;
}
export interface CatalogItem {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  image?: string;
  description: string;
  version: string;
  has_batch_no: boolean;
  has_expiry_date: boolean;
  can_edit: boolean;
  barcodes: { barcode: string }[];
  uoms: { uom: string; conversion_factor: number }[];
  attachments?: NativeFile[];
  images?: NativeFile[];
  stock?: ReportRow[];
  snapshot?: string;
}
export function presentCatalogItem(item: CatalogItem): StockItem {
  const locations: StockItem["locations"] = [];
  let available = 0,
    loaned = 0,
    damaged = 0;
  for (const row of item.stock || []) {
    const warehouse = String(row.warehouse || "");
    if (!warehouse) continue;
    let place = locations.find((place) => place.location === warehouse);
    if (!place) {
      place = {
        location: warehouse,
        label: String(row.warehouse_label || warehouse),
        available: 0,
        loaned: 0,
        damaged: 0,
        batches: [],
      };
      locations.push(place);
    }
    const quantities = {
      available: Number(row.available || 0),
      loaned: Number(row.loaned || 0),
      damaged: Number(row.damaged || 0),
    };
    available += quantities.available;
    loaned += quantities.loaned;
    damaged += quantities.damaged;
    for (const field of ["available", "loaned", "damaged"] as const)
      place[field] += quantities[field];
    if (row.batch_no)
      place.batches!.push({
        id: String(row.batch_no),
        ...quantities,
        expiry: String(row.expiry_date || ""),
        manufacturingDate: String(row.manufacturing_date || ""),
      });
  }
  return {
    code: item.item_code,
    name: item.item_name,
    category: item.item_group,
    uom: item.stock_uom,
    description: item.description,
    image: item.image,
    version: item.version,
    canEdit: item.can_edit,
    tracksBatch: item.has_batch_no,
    tracksExpiry: item.has_expiry_date,
    barcode: item.barcodes.map((row) => row.barcode).join("\n"),
    alternateUnits: item.uoms
      .filter((row) => row.uom !== item.stock_uom)
      .map((row) => ({ uom: row.uom, factor: row.conversion_factor })),
    available,
    loaned,
    damaged,
    locations,
  };
}
export function fileMime(file: NativeFile) {
  const type =
    file.file_type?.toLocaleLowerCase() ||
    file.file_name.split(".").at(-1)?.toLocaleLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(
    type || "",
  )
    ? `image/${type === "svg" ? "svg+xml" : type === "jpg" ? "jpeg" : type}`
    : "application/octet-stream";
}
