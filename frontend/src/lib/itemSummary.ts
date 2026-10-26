export function summarizeItems(names: string[] = [], count = names.length) {
  const cleanNames = names
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const total = Math.max(0, Number(count) || 0, cleanNames.length);
  if (cleanNames.length === 0) {
    return total > 1 ? `物品 等 ${total} 种物品` : "库存记录";
  }
  if (total <= 1) return cleanNames[0]!;
  return `${cleanNames[0] || "物品"} 等 ${total} 种物品`;
}
