import { movementLabels } from "./presentationLabels";

export const kindIcons = {
  Receive: { icon: "receive", label: movementLabels.Receive },
  Issue: { icon: "issue", label: movementLabels.Issue },
  Loss: { icon: "loss", label: movementLabels.Loss },
  Transfer: { icon: "transfer", label: movementLabels.Transfer },
  Loan: { icon: "loan", label: movementLabels.Loan },
  Return: { icon: "return", label: movementLabels.Return },
  Damage: { icon: "damage", label: movementLabels.Damage },
  Repair: { icon: "repair", label: movementLabels.Repair },
  Disposal: { icon: "disposal", label: movementLabels.Disposal },
  Reconcile: { icon: "count", label: movementLabels.Reconcile },
  Opening: { icon: "document", label: movementLabels.Opening },
} as const;

type MovementKind = keyof typeof kindIcons;
export const movementIcon = (kind: string) =>
  kindIcons[kind as MovementKind]?.icon || "movement";
