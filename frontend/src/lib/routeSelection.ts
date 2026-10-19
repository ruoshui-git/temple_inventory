export interface InitialAllocation {
  item_code: string;
  warehouse: string;
  batch_no: string;
  qty: number;
}
export function decodeAllocationSelection(value: unknown): {
  allocations: InitialAllocation[];
  error: string;
} {
  if (value === undefined || value === null)
    return { allocations: [], error: "" };
  try {
    if (typeof value !== "string") throw new Error();
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error();
    const allocations = parsed.map((row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error();
      const input = row as Record<string, unknown>;
      if (
        typeof input.item_code !== "string" ||
        !input.item_code.trim() ||
        typeof input.warehouse !== "string" ||
        !input.warehouse.trim() ||
        typeof input.qty !== "number" ||
        !Number.isFinite(input.qty) ||
        input.qty <= 0 ||
        (input.batch_no !== undefined && typeof input.batch_no !== "string")
      )
        throw new Error();
      return {
        item_code: input.item_code,
        warehouse: input.warehouse,
        batch_no: String(input.batch_no || ""),
        qty: input.qty,
      };
    });
    return { allocations, error: "" };
  } catch {
    return {
      allocations: [],
      error: "库存明细范围无效，请返回来源页面重新选择",
    };
  }
}
/** Item identities are JSON, so commas and other valid code characters stay intact. */
export function decodeItemSelection(value: unknown): {
  items: string[];
  error: string;
} {
  if (value === undefined || value === null) return { items: [], error: "" };
  try {
    if (typeof value !== "string") throw new Error();
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((code) => typeof code !== "string" || !code.trim())
    )
      throw new Error();
    return { items: [...new Set(parsed)] as string[], error: "" };
  } catch {
    return { items: [], error: "物品选择范围无效，请返回来源页面重新选择" };
  }
}
