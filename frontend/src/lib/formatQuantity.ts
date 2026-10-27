import { unitLabel } from "./units";

export function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(
    Number(value || 0),
  );
}

export function formatQuantityWithUnit(value: number, uom: string) {
  return `${formatQuantity(value)} ${unitLabel(uom)}`;
}
