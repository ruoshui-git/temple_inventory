import {
  themes,
  textScales,
  type ThemeId,
  type Density,
  type TextScale,
} from "../../src/lib/displayPreferences";
export {
  themes,
  textScales,
  type ThemeId,
  type Density,
  type TextScale,
} from "../../src/lib/displayPreferences";
export type Pattern = "current" | "proposed";
type PreviewPreferences = {
  textScale: TextScale;
  theme: ThemeId;
  density: Density;
  navigation: Pattern;
  actions: Pattern;
  form: Pattern;
};
const preferenceKey = "ti:design-preview:v3";
export const defaults: PreviewPreferences = {
  textScale: 100,
  theme: "jade",
  density: "balanced",
  navigation: "current",
  actions: "current",
  form: "current",
};

function readPreferences(
  storage: Pick<Storage, "getItem"> | undefined,
): PreviewPreferences {
  try {
    const saved = storage?.getItem(preferenceKey);
    const legacy = !saved
      ? storage?.getItem("ti:design-preview:v2") ||
        storage?.getItem("ti:design-preview:v1")
      : undefined;
    const value = JSON.parse(saved || legacy || "{}");
    return {
      textScale: textScales.includes(value?.textScale)
        ? value.textScale
        : defaults.textScale,
      theme:
        saved && themes.some((theme) => theme.id === value?.theme)
          ? value.theme
          : defaults.theme,
      density: ["compact", "balanced", "spacious"].includes(value?.density)
        ? value.density
        : defaults.density,
      navigation: defaults.navigation,
      actions: "current",
      form: saved && value?.form === "proposed" ? "proposed" : defaults.form,
    };
  } catch {
    return { ...defaults };
  }
}
function writePreferences(
  storage: Pick<Storage, "setItem"> | undefined,
  preferences: PreviewPreferences,
) {
  try {
    storage?.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    /* Private browsing remains usable. */
  }
}

export interface StockBatch {
  id: string;
  available: number;
  damaged?: number;
  expiry?: string;
}
export interface StockLocation {
  location: string;
  available: number;
  loaned: number;
  damaged: number;
  batches?: StockBatch[];
}
export interface StockItem {
  files?: import("./workflowModel").PreviewAttachment[];
  code: string;
  name: string;
  category: string;
  uom: string;
  tracksBatch: boolean;
  tracksExpiry: boolean;
  locations: StockLocation[];
  available: number;
  loaned: number;
  damaged: number;
  barcode?: string;
  description?: string;
  images?: string[];
  conversionVersion?: number;
  alternateUnits?: { uom: string; factor: number }[];
  illustration: "rice" | "oil" | "cloth" | "box" | "none";
}
export const previewDate = "2026-10-11";
export const locations = ["斋堂 / A-01", "斋堂 / A-02", "物资房 / B-01"];
type ItemFixture = Omit<StockItem, "available" | "loaned" | "damaged">;
function summarize(item: ItemFixture): StockItem {
  return {
    ...item,
    available: item.locations.reduce((sum, row) => sum + row.available, 0),
    loaned: item.locations.reduce((sum, row) => sum + row.loaned, 0),
    damaged: item.locations.reduce((sum, row) => sum + row.damaged, 0),
  };
}
// Fixture-only stock distribution; production inventory remains owned by ERPNext.
const fixtures: ItemFixture[] = [
  {
    code: "ITM-000128",
    name: "东北珍珠米",
    alternateUnits: [{ uom: "箱", factor: 10 }],
    category: "食品",
    uom: "袋",
    tracksBatch: true,
    tracksExpiry: true,
    illustration: "rice",
    locations: [
      {
        location: locations[0],
        available: 80,
        loaned: 0,
        damaged: 2,
        batches: [
          { id: "RICE-2609", available: 60, damaged: 2, expiry: "2027-03-01" },
          { id: "RICE-2610", available: 20, expiry: "2027-04-01" },
        ],
      },
      {
        location: locations[1],
        available: 32,
        loaned: 0,
        damaged: 0,
        batches: [{ id: "RICE-2609", available: 32, expiry: "2027-03-01" }],
      },
      {
        location: locations[2],
        available: 16,
        loaned: 0,
        damaged: 0,
        batches: [{ id: "RICE-2610", available: 16, expiry: "2027-04-01" }],
      },
    ],
  },
  {
    code: "ITM-000129",
    name: "非转基因菜籽油 5L",
    category: "食品",
    uom: "桶",
    tracksBatch: true,
    tracksExpiry: true,
    illustration: "oil",
    locations: [
      {
        location: locations[1],
        available: 36,
        loaned: 0,
        damaged: 0,
        batches: [{ id: "OIL-2610", available: 36, expiry: "2026-10-28" }],
      },
    ],
  },
  {
    code: "ITM-000130",
    name: "义工纯棉工作服 · 秋冬长袖加厚款",
    category: "服装",
    uom: "件",
    tracksBatch: false,
    tracksExpiry: false,
    illustration: "cloth",
    locations: [
      { location: locations[1], available: 24, loaned: 4, damaged: 0 },
      { location: locations[2], available: 40, loaned: 8, damaged: 1 },
    ],
  },
  {
    code: "ITM-000131",
    name: "食品级保鲜盒",
    category: "日用品",
    uom: "个",
    tracksBatch: false,
    tracksExpiry: false,
    illustration: "box",
    locations: [
      { location: locations[1], available: 48, loaned: 6, damaged: 0 },
    ],
  },
  {
    code: "ITM-000132",
    name: "香菇干货",
    category: "食品",
    uom: "袋",
    tracksBatch: true,
    tracksExpiry: true,
    illustration: "none",
    locations: [
      {
        location: locations[0],
        available: 0,
        loaned: 0,
        damaged: 3,
        batches: [
          { id: "MUSH-2509", available: 0, damaged: 3, expiry: "2026-09-30" },
        ],
      },
    ],
  },
  {
    code: "ITM-000133",
    name: "法会布幔与配套收纳袋",
    category: "服装",
    uom: "件",
    tracksBatch: true,
    tracksExpiry: false,
    illustration: "cloth",
    locations: [
      {
        location: locations[2],
        available: 18,
        loaned: 4,
        damaged: 0,
        batches: [{ id: "TEXTILE-2610", available: 18 }],
      },
    ],
  },
];
export const items = fixtures.map(summarize);
const warehouseNodes = [
  { name: "斋堂", label: "斋堂", is_group: true },
  ...locations.slice(0, 2).map((location, index) => ({
    name: location,
    label: index ? "A-02 · 食品与用品" : "A-01 · 米粮",
    parent: "斋堂",
    count: items.filter((item) =>
      item.locations.some((row) => row.location === location),
    ).length,
  })),
  { name: "物资房", label: "物资房", is_group: true },
  {
    name: locations[2],
    label: "B-01 · 衣物",
    parent: "物资房",
    count: items.filter((item) =>
      item.locations.some((row) => row.location === locations[2]),
    ).length,
  },
];
function filterItems(
  search: string,
  warehouses: string[],
  category: string,
  source: StockItem[] = items,
) {
  const term = search.trim().toLowerCase();
  return source
    .filter(
      (item) =>
        (!term || `${item.name} ${item.code}`.toLowerCase().includes(term)) &&
        (!category || item.category === category),
    )
    .map((item) =>
      summarize({
        ...item,
        locations: item.locations.filter(
          (row) =>
            !warehouses.length ||
            warehouses.some(
              (warehouse) =>
                row.location === warehouse ||
                row.location.startsWith(`${warehouse} /`),
            ),
        ),
      }),
    )
    .filter((item) => !warehouses.length || item.locations.length);
}
export function itemBatches(item: StockItem) {
  if (!item.tracksBatch) return [];
  const result = new Map<string, StockBatch>();
  item.locations.forEach((row) =>
    row.batches?.forEach((batch) => {
      const existing = result.get(batch.id);
      result.set(batch.id, {
        ...batch,
        available: (existing?.available || 0) + batch.available,
      });
    }),
  );
  return [...result.values()];
}
export function expiryStatus(item: StockItem) {
  if (!item.tracksExpiry) return null;
  const dates = itemBatches(item)
    .flatMap((batch) => (batch.expiry ? [batch.expiry] : []))
    .sort();
  if (!dates.length) return null;
  const days = (Date.parse(dates[0]) - Date.parse(previewDate)) / 86400000;
  return days < 0 ? "已过期" : "未过期";
}
export function quantities(
  rows: StockItem[],
  field: "available" | "loaned" | "damaged" = "available",
) {
  const totals = new Map<string, number>();
  rows.forEach((row) =>
    totals.set(row.uom, (totals.get(row.uom) || 0) + row[field]),
  );
  return [...totals].map(([uom, qty]) => ({ uom, qty }));
}
type ReceiveLine = {
  id: number;
  code: string;
  qty: number;
  location: string;
  batch: string;
  expiry: string;
};
function validateLines(lines: ReceiveLine[]) {
  if (!lines.length) return "请先添加至少一项物品。";
  if (lines.some((line) => !Number.isFinite(line.qty) || line.qty <= 0))
    return "数量必须大于 0，请检查标记的物品。";
  if (lines.some((line) => !locations.includes(line.location)))
    return "请选择有效的入库位置。";
  if (
    lines.some(
      (line) =>
        items.find((item) => item.code === line.code)?.tracksBatch &&
        !line.batch.trim(),
    )
  )
    return "批次管理物品需要填写批次编号。";
  if (
    lines.some(
      (line) =>
        items.find((item) => item.code === line.code)?.tracksExpiry &&
        !line.expiry,
    )
  )
    return "效期管理物品需要填写到期日期。";
  return "";
}
