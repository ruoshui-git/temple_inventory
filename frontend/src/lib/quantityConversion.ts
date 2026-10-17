export interface ConversionLine {
  code: string;
  qty: number;
  uom: string;
  entryUom?: string;
  entryQty?: number;
  conversionFactor?: number;
}
export interface QuantityUnit {
  name: string;
  whole: boolean;
}
const precise = (value: number) =>
  Math.abs(value * 1e6 - Math.round(value * 1e6)) < 1e-6;
const wholeNumber = (value: number) =>
  Math.abs(value - Math.round(value)) < 1e-8;
export function conversionFactorError(
  unit: string,
  factor: number,
  stockUnit: string,
  units: QuantityUnit[],
) {
  if (!Number.isFinite(factor) || factor <= 0 || !precise(factor))
    return "换算比例必须是大于 0 的有限数，最多六位小数。";
  if (unit === stockUnit && factor !== 1) return "库存单位的换算比例必须为 1。";
  if (!units.some((row) => row.name === unit)) return "请选择已创建的单位。";
  return "";
}
export function conversionError(
  quantity: number,
  unit: string,
  factor: number,
  stockUnit: string,
  units: QuantityUnit[],
) {
  const factorError = conversionFactorError(unit, factor, stockUnit, units);
  if (factorError) return factorError;
  if (!Number.isFinite(quantity) || quantity <= 0 || !precise(quantity))
    return "输入数量必须大于 0，最多六位小数。";
  if (
    units.find((row) => row.name === unit)?.whole &&
    !Number.isInteger(quantity)
  )
    return `${unit}只允许整数数量。`;
  const stock = quantity * factor;
  if (!Number.isFinite(stock) || !precise(stock))
    return "折合库存数量最多六位小数。";
  if (units.find((row) => row.name === stockUnit)?.whole && !wholeNumber(stock))
    return `${stockUnit}只允许整数数量。`;
  return "";
}
export function enteredQty(line: ConversionLine) {
  return line.entryQty ?? line.qty;
}
export function recordConversion(
  line: ConversionLine,
  conversions: { uom: string; factor: number }[] = [],
) {
  if (line.entryQty !== undefined && line.conversionFactor !== undefined)
    return;
  const factor =
    line.entryUom && line.entryUom !== line.uom
      ? conversions.find((row) => row.uom === line.entryUom)?.factor
      : 1;
  line.conversionFactor = factor ?? NaN;
  line.entryQty = line.qty / line.conversionFactor;
  line.entryUom ||= line.uom;
}
export function setEnteredQty(line: ConversionLine, value: number) {
  line.entryQty = value;
  const stock = value * (line.conversionFactor ?? NaN);
  // Preserve invalid fractions visibly so validation can reject them.
  line.qty = precise(stock) ? Number(stock.toFixed(6)) : stock;
}
export function applyLineConversion(
  line: ConversionLine,
  unit: string,
  factor: number,
  quantity: number,
) {
  line.entryUom = unit;
  line.conversionFactor = factor;
  setEnteredQty(line, quantity);
}
