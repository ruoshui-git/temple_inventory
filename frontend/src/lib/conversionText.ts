import { formatQuantity } from "./formatQuantity";
import { unitLabel } from "./units";

export interface ConversionTextInput {
  qty: number;
  uom: string;
  factor: number;
  stockUom: string;
}

/** Describe an entered quantity in its stock unit without mixing a rate into the quantity. */
export function formatConversion({
  qty,
  uom,
  factor,
  stockUom,
}: ConversionTextInput) {
  if (
    !uom ||
    !stockUom ||
    uom === stockUom ||
    !Number.isFinite(factor) ||
    factor <= 0
  )
    return null;
  const entered = `${formatQuantity(qty)} ${unitLabel(uom)}`;
  const stock = `${formatQuantity(qty * factor)} ${unitLabel(stockUom)}`;
  const rate = `1 ${unitLabel(uom)} = ${formatQuantity(factor)} ${unitLabel(stockUom)}`;
  return `${entered} = ${stock}${qty === 1 ? "" : `（${rate}）`}`;
}
