export const kindIcons = {
  Receive: { icon: "receive", label: "入库" },
  Issue: { icon: "issue", label: "出库" },
  Loss: { icon: "loss", label: "遗失" },
  Transfer: { icon: "transfer", label: "调拨" },
  Loan: { icon: "loan", label: "借出" },
  Return: { icon: "return", label: "归还" },
  Damage: { icon: "damage", label: "损坏" },
  Repair: { icon: "repair", label: "修复归库" },
  Disposal: { icon: "disposal", label: "报废" },
  Reconcile: { icon: "count", label: "盘点调整" },
  Opening: { icon: "document", label: "期初库存" },
} as const;

export type MovementKind = keyof typeof kindIcons;
export const movementLabels: Record<string, string> = Object.fromEntries(
  Object.entries(kindIcons).map(([kind, value]) => [kind, value.label]),
);
export const movementIcon = (kind: string) =>
  kindIcons[kind as MovementKind]?.icon || "movement";
export const operationLabels = Object.fromEntries(
  Object.entries(kindIcons)
    .filter(([kind]) => kind !== "Reconcile" && kind !== "Opening")
    .map(([kind, value]) => [kind, value.label]),
) as Record<Exclude<MovementKind, "Reconcile" | "Opening">, string>;
