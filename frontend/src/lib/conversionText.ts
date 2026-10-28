import { formatQuantity, formatQuantityWithUnit } from "./formatQuantity";

interface ConversionTextInput {
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
  const entered = formatQuantityWithUnit(qty, uom);
  const stock = formatQuantityWithUnit(qty * factor, stockUom);
  const enteredUnit = formatQuantityWithUnit(1, uom).replace(/^1\s*/, "");
  const rate = `1 ${enteredUnit} = ${formatQuantityWithUnit(factor, stockUom)}`;
  return `${entered} = ${stock}${qty === 1 ? "" : `（${rate}）`}`;
}
