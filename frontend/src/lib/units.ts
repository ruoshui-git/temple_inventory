// Row values are often typed `unknown`; anything that is not a unit object is
// read as its string form.
export type UnitLike = unknown;

function unitName(uom: UnitLike): string {
  if (uom && typeof uom === "object" && "name" in uom)
    return String((uom as { name: unknown }).name || "");
  return uom == null ? "" : String(uom);
}

type UnitSource = { units: { name: string; label?: string }[] };
let source: UnitSource | undefined;

// The reference-data provider registers its reactive store here, so labels and
// ranks also resolve in controllers, event handlers and async code.
export function setUnitSource(next: UnitSource | undefined) {
  source = next;
}

function units() {
  return source?.units || [];
}

export function unitLabel(uom: UnitLike): string {
  const name = unitName(uom);
  if (!name) return "";
  if (uom && typeof uom === "object" && "label" in uom && uom.label)
    return String(uom.label);
  return units().find((unit) => unit.name === name)?.label || name;
}

export type UnitOption = { value: string; label: string; detail?: string };

export function unitOption(
  uom: UnitLike,
  options: {
    factor?: number;
    stockUom?: UnitLike;
    category?: string | null;
    whole?: boolean;
  } = {},
): UnitOption {
  const name = unitName(uom);
  const label = unitLabel(uom);
  const details = [label !== name ? name : ""];
  if (options.factor !== undefined && options.stockUom) {
    details.push(
      `1 ${label} = ${options.factor} ${unitLabel(options.stockUom)}`,
    );
  }
  if (options.category) details.push(options.category);
  if (options.whole !== undefined)
    details.push(options.whole ? "整数数量" : "允许小数");
  const detail = details.filter(Boolean).join(" · ");
  return { value: name, label, ...(detail ? { detail } : {}) };
}

export function unitRank(uom: UnitLike): number {
  const name = unitName(uom);
  if (!name) return Number.MAX_SAFE_INTEGER;
  const index = units().findIndex((unit) => unit.name === name);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareUnits(a: UnitLike, b: UnitLike): number {
  const rankDifference = unitRank(a) - unitRank(b);
  if (Number.isFinite(rankDifference) && rankDifference !== 0)
    return rankDifference;
  return unitName(a).localeCompare(unitName(b), "zh-CN", {
    sensitivity: "base",
  });
}

export function sortByUnit<T>(list: T[], getUom: (value: T) => UnitLike): T[] {
  return [...list].sort((a, b) => compareUnits(getUom(a), getUom(b)));
}
