import { unitLabel } from "./units";

export function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(
    Number(value || 0),
  );
}

export function formatQuantityWithUnit(
  value: number,
  uom: unknown,
  unknownUnit = "未知单位",
) {
  return `${formatQuantity(value)} ${unitLabel(uom) || unknownUnit}`;
}
