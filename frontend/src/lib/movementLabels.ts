export const movementLabels: Record<string, string> = {
  Receive: "入库",
  Issue: "出库",
  Transfer: "转移",
  Loan: "借出",
  Return: "归还",
  Damage: "损坏",
  Loss: "遗失",
  Repair: "修复",
  Disposal: "报废",
  Reconcile: "库存调整",
  Opening: "期初库存",
};

export function movementLabel(kind?: string | null): string {
  return kind ? movementLabels[kind] || kind : "库存变动";
}
