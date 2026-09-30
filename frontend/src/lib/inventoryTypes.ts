export interface InventoryCardRow {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  image?: string | null;
  description?: string | null;
  available_stock: number;
  total_stock: number;
  on_loan_qty: number;
  damaged_qty: number;
  warehouse_stock?: Record<string, number>;
  has_batch_no?: boolean | number;
  batch_count?: number;
  batches?: Array<{
    batch_no: string;
    qty: number;
    expiry_date?: string | null;
  }>;
  nearest_expiry_date?: string | null;
  nearest_expiry_days?: number | null;
}
