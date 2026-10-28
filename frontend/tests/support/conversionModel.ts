import { reactive } from "vue";
import {
  reviewSession,
  type DraftLine,
  type ReviewSession,
} from "./reviewModel";

/** Preview supporting-record failures; never connected to stock services. */
export const conversionAccess = reactive({
  createUnit: true,
  updateItem: true,
  failSave: false,
  staleItem: false,
});
const precise = (value: number) =>
  Math.abs(value * 1e6 - Math.round(value * 1e6)) < 1e-6;
const wholeNumber = (value: number) =>
  Math.abs(value - Math.round(value)) < 1e-8;
export function conversionFactorError(
  unit: string,
  factor: number,
  stockUnit: string,
  session: ReviewSession = reviewSession,
) {
  if (!Number.isFinite(factor) || factor <= 0 || !precise(factor))
    return "换算比例必须是大于 0 的有限数，最多六位小数。";
  if (unit === stockUnit && factor !== 1) return "库存单位的换算比例必须为 1。";
  if (!session.units.some((row) => row.name === unit))
    return "请选择已创建的单位。";
  return "";
}
export function conversionError(
  quantity: number,
  unit: string,
  factor: number,
  stockUnit: string,
  session: ReviewSession = reviewSession,
) {
  const factorError = conversionFactorError(unit, factor, stockUnit, session);
  if (factorError) return factorError;
  if (!Number.isFinite(quantity) || quantity <= 0 || !precise(quantity))
    return "输入数量必须大于 0，最多六位小数。";
  if (
    session.units.find((row) => row.name === unit)?.whole &&
    !Number.isInteger(quantity)
  )
    return `${unit}只允许整数数量。`;
  const stock = quantity * factor;
  if (!Number.isFinite(stock) || !precise(stock))
    return "折合库存数量最多六位小数。";
  if (
    session.units.find((row) => row.name === stockUnit)?.whole &&
    !wholeNumber(stock)
  )
    return `${stockUnit}只允许整数数量。`;
  return "";
}
export function enteredQty(line: DraftLine) {
  return line.entryQty ?? line.qty;
}
export function recordConversion(line: DraftLine, session?: ReviewSession) {
  if (line.entryQty !== undefined && line.conversionFactor !== undefined)
    return;
  const factor =
    line.entryUom && line.entryUom !== line.uom
      ? (session || reviewSession).stock
          .find((item) => item.code === line.code)
          ?.alternateUnits?.find((row) => row.uom === line.entryUom)?.factor
      : 1;
  line.conversionFactor = factor ?? NaN;
  line.entryQty = line.qty / line.conversionFactor;
  line.entryUom ||= line.uom;
}
export function setEnteredQty(line: DraftLine, value: number) {
  line.entryQty = value;
  const stock = value * (line.conversionFactor ?? 1);
  line.qty = precise(stock) ? Number(stock.toFixed(6)) : stock;
}
export function applyLineConversion(
  line: DraftLine,
  unit: string,
  factor: number,
  quantity: number,
) {
  line.entryUom = unit;
  line.conversionFactor = factor;
  setEnteredQty(line, quantity);
}
function saveItemConversion(
  code: string,
  unit: string,
  factor: number,
  version: number,
  session: ReviewSession = reviewSession,
) {
  const item = session.stock.find((row) => row.code === code);
  if (!conversionAccess.updateItem)
    return "没有更新物品换算的权限；可取消常用换算选项，仅应用于此分配。";
  if (
    !item ||
    conversionAccess.staleItem ||
    (item.conversionVersion || 0) !== version
  )
    return "物品换算已被修改，请重新载入常用换算后核对。输入已保留。";
  if (conversionAccess.failSave)
    return "常用换算保存失败，输入已保留；请重试。";
  if (!Number.isFinite(factor) || factor <= 0 || !precise(factor))
    return "换算比例必须是大于 0 的有限数，最多六位小数。";
  if (unit === item.uom && factor !== 1) return "库存单位的换算比例必须为 1。";
  if (!session.units.some((row) => row.name === unit))
    return "请选择已创建的单位。";
  item.alternateUnits ||= [];
  const existing = item.alternateUnits.find((row) => row.uom === unit);
  if (existing) existing.factor = factor;
  else if (unit !== item.uom) item.alternateUnits.push({ uom: unit, factor });
  item.conversionVersion = version + 1;
  return "";
}
export function createPreviewUnit(
  name: string,
  whole: boolean,
  session: ReviewSession = reviewSession,
) {
  if (!conversionAccess.createUnit)
    return "没有新建单位的权限。可选择已有单位。";
  if (!name.trim()) return "请填写单位名称。";
  if (
    session.units.some(
      (row) => row.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    )
  )
    return "单位已存在，请选择已有单位。";
  if (conversionAccess.failSave) return "单位保存失败，输入已保留；请重试。";
  session.units.push({ name: name.trim(), whole });
  return "";
}
