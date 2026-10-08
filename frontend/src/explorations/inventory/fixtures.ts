import type { WarehouseRecord } from "../../lib/warehousePresenter";

export type InventoryItem = {
  code: string;
  name: string;
  subtitle: string;
  category: string;
  uom: string;
  available: number;
  loaned: number;
  damaged: number;
  total: number;
  locations: string[];
  batches: { code: string; expiry?: string; quantity: number }[];
  photo: number | null;
};

export type InventoryBatchRow = {
  code: string;
  expiry?: string;
  quantity: number;
  item: InventoryItem;
};

export const fixtureDate = "2026-09-29";
export const warehouses: WarehouseRecord[] = [
  {
    name: "root",
    local_label: "全部仓库",
    semantic_type: "group",
    is_group: 1,
  },
  {
    name: "hall",
    local_label: "大殿",
    parent_warehouse: "root",
    semantic_type: "room",
    is_group: 1,
  },
  {
    name: "hall-shelf",
    local_label: "储物架",
    parent_warehouse: "hall",
    semantic_type: "location",
    is_group: 0,
  },
  {
    name: "hall-cabinet",
    local_label: "侧柜",
    parent_warehouse: "hall",
    semantic_type: "location",
    is_group: 0,
  },
  {
    name: "kitchen",
    local_label: "厨房",
    parent_warehouse: "root",
    semantic_type: "room",
    is_group: 1,
  },
  {
    name: "kitchen-shelf",
    local_label: "储物架",
    parent_warehouse: "kitchen",
    semantic_type: "location",
    is_group: 0,
  },
  {
    name: "kitchen-cold",
    local_label: "冷藏柜",
    parent_warehouse: "kitchen",
    semantic_type: "location",
    is_group: 0,
  },
];
export const categories = [
  { name: "daily", item_group_name: "生活物资", is_group: 1 },
  {
    name: "个人用品",
    item_group_name: "个人用品",
    parent_item_group: "daily",
    is_group: 0,
  },
  {
    name: "厨房用品",
    item_group_name: "厨房用品",
    parent_item_group: "daily",
    is_group: 0,
  },
  {
    name: "清洁用品",
    item_group_name: "清洁用品",
    parent_item_group: "daily",
    is_group: 0,
  },
  { name: "equipment", item_group_name: "设备与活动", is_group: 1 },
  {
    name: "电子用品",
    item_group_name: "电子用品",
    parent_item_group: "equipment",
    is_group: 0,
  },
  {
    name: "办公用品",
    item_group_name: "办公用品",
    parent_item_group: "equipment",
    is_group: 0,
  },
  {
    name: "活动用品",
    item_group_name: "活动用品",
    parent_item_group: "equipment",
    is_group: 0,
  },
  { name: "医疗防护", item_group_name: "医疗防护", is_group: 0 },
];

// Product thumbnails are CSS windows into the supplied reference, never remote assets.
export const photoOffsets = [
  248, 299, 351, 404, 456, 509, 561, 614, 667, 719, 771, 824, 876, 929, 981,
];
const seeds: Array<
  [string, string, string, string, number, number, number, number | null]
> = [
  ["鼻吸棒 SIGNAL", "Natural Inhaler · 2 ml", "个人用品", "Nos", 328, 12, 2, 0],
  ["柯达相机", "KODAK camera · 35 mm", "电子用品", "Nos", 56, 8, 4, 1],
  [
    "一次性口罩 10 个装",
    "医用防护口罩 · 三层过滤",
    "医疗防护",
    "包",
    1240,
    0,
    10,
    2,
  ],
  ["饼干烤盘", "不锈钢 · 30 × 20 cm", "厨房用品", "Nos", 86, 10, 4, 3],
  ["厨房隔热垫", "硅胶防烫垫 · 18 cm", "厨房用品", "Nos", 213, 18, 1, 4],
  ["A5 笔记本", "米黄色 · 80 页", "办公用品", "Nos", 342, 16, 2, 5],
  ["5 号电池 AA", "南孚碱性电池 · 4 粒装", "电子用品", "包", 418, 0, 6, 6],
  ["不锈钢保温杯", "真空保温 · 500 ml", "个人用品", "Nos", 97, 20, 3, 7],
  ["免洗洗手液", "75% 酒精 · 500 ml", "医疗防护", "瓶", 310, 0, 4, 8],
  ["垃圾袋", "加厚黑色 · 45 × 50 cm", "清洁用品", "包", 10081, 0, 8, 9],
  ["插线板 4 位", "1.8 米 · 带开关", "电子用品", "Nos", 154, 22, 4, 10],
  ["办公椅", "人体工学网布 · 黑色", "活动用品", "Nos", 28, 2, 0, 11],
  ["收纳箱 50 L", "透明带盖 · 可堆叠", "活动用品", "Nos", 76, 4, 0, 12],
  ["螺丝刀套装", "家用维修 · 12 件套", "活动用品", "Nos", 189, 8, 3, 13],
  ["抽纸 100 抽", "三层加厚 · 12 包装", "个人用品", "包", 450, 0, 10, 14],
  [
    "大型法会志愿者工作围裙 Volunteer waterproof kitchen apron",
    "深棕色 · 加长可调节款",
    "活动用品",
    "Nos",
    28,
    3,
    1,
    null,
  ],
  [
    "备用扩音器",
    "Portable megaphone · 待补充",
    "电子用品",
    "Nos",
    0,
    0,
    0,
    null,
  ],
];

export const items: InventoryItem[] = Array.from({ length: 3 }, (_, variant) =>
  seeds.map(
    (
      [name, subtitle, category, uom, available, loaned, damaged, photo],
      index,
    ) => {
      const code = `ITM-${String(161 + variant * seeds.length + index).padStart(6, "0")}`;
      const quantity = available + loaned + damaged;
      const tracked = [0, 2, 8, 14].includes(index);
      const trackedBatches =
        variant === 0 && index === 0
          ? [
              {
                code: `${code}-A`,
                expiry: "2026-09-20",
                quantity: Math.floor(quantity / 4),
              },
              {
                code: `${code}-B`,
                expiry: "2026-10-12",
                quantity: Math.floor(quantity / 4),
              },
              {
                code: `${code}-C`,
                expiry: "2027-03-15",
                quantity: quantity - Math.floor(quantity / 4) * 2,
              },
            ]
          : tracked
            ? [
                {
                  code: `${code}-A`,
                  expiry: index === 8 ? "2026-09-15" : "2026-10-12",
                  quantity: Math.floor(quantity / 3),
                },
                {
                  code: `${code}-B`,
                  expiry: "2027-03-15",
                  quantity: quantity - Math.floor(quantity / 3),
                },
              ]
            : index === 6
              ? [{ code: `${code}-A`, quantity }]
              : [];
      return {
        code,
        name: name + (variant ? ["", " · 小号", " · 大号"][variant] : ""),
        subtitle,
        category,
        uom,
        available,
        loaned,
        damaged,
        total: quantity,
        photo,
        locations:
          category === "厨房用品"
            ? ["kitchen-shelf", "hall-shelf"]
            : index % 3 === 0
              ? ["hall-shelf", "hall-cabinet", "kitchen-shelf"]
              : ["hall-shelf"],
        batches: trackedBatches,
      };
    },
  ),
).flat();

export const destinations = [
  { label: "库存", path: "/", icon: "box" },
  { label: "货物流动", path: "/movements", icon: "movement" },
  { label: "货物流动", path: "/movements/records", icon: "adjust" },
  { label: "借用", path: "/loans", icon: "loan" },
  { label: "仓库", path: "/warehouses", icon: "warehouse" },
  { label: "更多", path: "/more", icon: "more" },
];

export const batches: InventoryBatchRow[] = items.flatMap((item) =>
  item.batches.map((batch) => ({ ...batch, item })),
);

export function daysFromFixtureDate(expiry?: string) {
  if (!expiry) return null;
  const start = Date.parse(`${fixtureDate}T00:00:00Z`);
  const end = Date.parse(`${expiry}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function matchesExpiry(expiry: string | undefined, filter: string) {
  if (filter === "all") return true;
  if (filter === "none") return !expiry;
  const days = daysFromFixtureDate(expiry);
  if (days === null) return false;
  if (filter === "overdue_within") return days >= -30 && days <= -1;
  if (filter === "overdue_beyond") return days <= -31;
  if (filter === "remaining_within") return days >= 0 && days <= 30;
  if (filter === "remaining_beyond") return days >= 31;
  if (filter === "custom") return days >= -30 && days <= 30;
  const window = Number(filter);
  return days >= 0 && days <= window;
}

export const expiryNavigationCount = batches.filter(
  (batch) => batch.quantity > 0,
).length;

export function expiryStatus(item: InventoryItem) {
  const dates = item.batches
    .flatMap((batch) => (batch.expiry ? [batch.expiry] : []))
    .sort();
  if (!dates.length) return null;
  return {
    date: dates[0],
    expired: dates[0] < fixtureDate,
    soon: dates[0] <= "2026-10-29",
  };
}
