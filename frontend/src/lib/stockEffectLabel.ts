import { formatQuantityWithUnit } from "./formatQuantity";

export function stockEffectLabel(effect: number, uom: unknown): string {
  if (effect > 0)
    return `可用库存增加 ${formatQuantityWithUnit(Math.abs(effect), uom)}`;
  if (effect < 0)
    return `可用库存减少 ${formatQuantityWithUnit(Math.abs(effect), uom)}`;
  return "可用库存无变化";
}
