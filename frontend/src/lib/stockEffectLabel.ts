import { formatQuantity } from "./formatQuantity";

export function stockEffectLabel(effect: number): string {
  if (effect > 0) return `可用库存增加 ${formatQuantity(effect)} 单位`;
  if (effect < 0)
    return `可用库存减少 ${formatQuantity(Math.abs(effect))} 单位`;
  return "可用库存无变化";
}
