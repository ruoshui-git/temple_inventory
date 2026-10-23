import { recordConversion, conversionAccess } from "./conversionModel";
import { toRaw, reactive } from "vue";
import {
  emptyScope,
  type BrowseScope,
  type PreviewPeriod,
} from "./browseModel";
import { items, locations, previewDate, type StockItem } from "./model";

export type PreviewPage =
  | "dashboard"
  | "inventory"
  | "expiry"
  | "movement-items"
  | "movement-records"
  | "loan-items"
  | "loan-records"
  | "loan-detail"
  | "warehouses"
  | "warehouse-detail"
  | "pending"
  | "drafts"
  | "counts"
  | "item-detail"
  | "item-form"
  | "movement-form"
  | "reconciliation-form"
  | "reports"
  | "activity-list"
  | "activity-detail"
  | "activity-form"
  | "more"
  | "settings"
  | "setup"
  | "recovery"
  | "auth-complete";

export type PreviewPageKey = `${PreviewPage}/${string}`;

export interface PreviewPageRoute {
  key: PreviewPageKey;
  page: PreviewPage;
  variant: string;
  path: string;
  label: string;
  group:
    "首页" | "库存" | "货物流动" | "借用" | "仓库" | "更多" | "导出" | "表单";
  readOnly?: boolean;
}

const route = <P extends PreviewPage>(
  page: P,
  variant: string,
  path: string,
  label: string,
  group: PreviewPageRoute["group"],
  readOnly = false,
): PreviewPageRoute => ({
  key: `${page}/${variant}`,
  page,
  variant,
  path,
  label,
  group,
  readOnly,
});

export const previewPages: readonly PreviewPageRoute[] = [
  route("dashboard", "overview", "/", "物资总览", "首页"),
  route(
    "movement-form",
    "Receive-50",
    "/preview/receive-50",
    "50种物品入库 · 完整",
    "表单",
  ),
  route(
    "movement-form",
    "Receive-50-invalid",
    "/preview/receive-50-invalid",
    "50种物品入库 · 待完善",
    "表单",
  ),
  route("inventory", "list", "/stock", "库存列表", "库存"),
  route("inventory", "filtered", "/stock", "筛选结果", "库存"),
  route("inventory", "empty", "/stock", "无匹配结果", "库存"),
  route("expiry", "soon", "/stock/expiry", "30天内到期", "库存"),
  route("expiry", "expired", "/stock/expiry", "已过期", "库存"),
  route("expiry", "unexpired", "/stock/expiry", "未过期", "库存"),
  route("expiry", "undated", "/stock/expiry", "无效期", "库存"),
  route("expiry", "all", "/stock/expiry", "全部批次", "库存"),
  route(
    "movement-items",
    "list",
    "/movements?view=items",
    "流动 · 按物品",
    "货物流动",
  ),
  route(
    "movement-items",
    "filtered",
    "/movements?view=items",
    "流动物品筛选",
    "货物流动",
  ),
  route(
    "movement-records",
    "draft",
    "/movements?view=records",
    "草稿记录",
    "货物流动",
  ),
  route(
    "movement-records",
    "completed",
    "/movements?view=records",
    "已完成记录",
    "货物流动",
  ),
  route(
    "movement-records",
    "cancelled",
    "/movements?view=records",
    "已取消记录",
    "货物流动",
  ),
  route(
    "movement-records",
    "detail",
    "/movements?view=records",
    "记录详情",
    "货物流动",
  ),
  route(
    "movement-records",
    "selected",
    "/movements?view=records",
    "选中记录详情",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "opening",
    "/movements?view=records",
    "期初记录详情",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "workspace-detail",
    "/movements/MAT-STE-2026-00017",
    "前端创建的库存记录",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "entry-detail",
    "/movements/MAT-STE-2026-00003",
    "库存分录详情",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "external",
    "/app/purchase-receipt/MAT-PRE-2026-00001",
    "其他 ERPNext 库存凭证",
    "货物流动",
    true,
  ),
  route(
    "loan-items",
    "outstanding",
    "/loans?view=items",
    "未归还 · 按物品",
    "借用",
  ),
  route(
    "loan-items",
    "returned",
    "/loans?view=items",
    "已归还 · 按物品",
    "借用",
  ),
  route("loan-items", "damaged", "/loans?view=items", "损坏 · 按物品", "借用"),
  route("loan-items", "lost", "/loans?view=items", "遗失 · 按物品", "借用"),
  route("loan-records", "all", "/loans?view=records", "全部借用记录", "借用"),
  route("loan-items", "all", "/loans?view=items", "全部借用物品", "借用"),
  route("loan-records", "open", "/loans?view=records", "未结清记录", "借用"),
  route("loan-records", "settled", "/loans?view=records", "已结清记录", "借用"),
  route("loan-records", "draft", "/loans?view=records", "借用草稿", "借用"),
  route(
    "loan-records",
    "detail",
    "/loans?view=records",
    "借用记录详情",
    "借用",
  ),
  route(
    "loan-detail",
    "outstanding",
    "/loans/MAT-STE-2026-00004",
    "待归还借用",
    "借用",
  ),
  route(
    "loan-detail",
    "returned",
    "/loans/MAT-STE-2026-00005",
    "已归还借用",
    "借用",
  ),
  route(
    "loan-detail",
    "damaged",
    "/loans/MAT-STE-2026-00006",
    "损坏结清借用",
    "借用",
  ),
  route(
    "loan-detail",
    "selected",
    "/loans/MAT-STE-2026-00004",
    "选中借用记录详情",
    "借用",
    true,
  ),
  route("warehouses", "tree", "/stock/warehouses", "仓库树", "库存"),
  route("warehouses", "create", "/stock/warehouses", "新建仓库", "库存"),
  route("warehouses", "edit", "/stock/warehouses", "编辑仓库", "库存"),
  route(
    "warehouse-detail",
    "overview",
    "/stock/warehouses/斋堂",
    "仓库详情",
    "库存",
  ),
  route(
    "warehouse-detail",
    "edit",
    "/stock/warehouses/斋堂",
    "编辑仓库详情",
    "库存",
  ),
  route("pending", "actionable", "/stock/damaged", "损坏待处理", "库存"),
  route("drafts", "open", "/drafts", "草稿", "更多"),
  route("counts", "records", "/counts", "盘点调整记录", "更多"),
  route(
    "item-detail",
    "overview",
    "/stock/items/ITM-000128",
    "物品详情",
    "库存",
  ),
  route(
    "item-detail",
    "batches",
    "/stock/items/ITM-000128",
    "物品批次",
    "库存",
  ),
  route("item-form", "new", "/stock/items/new", "新建物品", "表单"),
  route(
    "item-form",
    "edit",
    "/stock/items/new?preview=edit&code=ITM-000128",
    "编辑物品",
    "表单",
  ),
  ...(
    [
      "Receive",
      "Issue",
      "Transfer",
      "Loan",
      "Return",
      "Damage",
      "Loss",
      "Repair",
      "Disposal",
    ] as const
  ).map((kind) =>
    route(
      "movement-form",
      kind,
      `/movements/new/${kind}`,
      `${{ Receive: "入库", Issue: "出库", Transfer: "转移", Loan: "借出", Return: "归还", Damage: "标记损坏", Loss: "记录遗失", Repair: "修复归库", Disposal: "正式报废" }[kind]}登记`,
      "表单",
    ),
  ),
  route("reconciliation-form", "new", "/counts/new", "新建盘点", "表单"),
  route(
    "reconciliation-form",
    "detail",
    "/counts/MAT-RECO-2026-00015",
    "盘点记录详情",
    "表单",
  ),
  route("reports", "overview", "/reports", "导出", "导出"),
  ...["inventory", "expiry", "movements", "loans", "activities", "counts"].map(
    (dataset) =>
      route(
        "reports",
        dataset,
        `/reports?dataset=${dataset}`,
        `导出 · ${{ inventory: "库存", expiry: "效期 / 批次", movements: "货物流动", loans: "借用", activities: "活动", counts: "盘点" }[dataset]}`,
        "导出",
      ),
  ),
  route(
    "activity-list",
    "large",
    "/preview/activities-large",
    "活动 · 长文本与大结果集",
    "更多",
  ),
  route("activity-list", "active", "/activities", "活动", "更多"),
  route(
    "activity-detail",
    "selected",
    "/activities/selected",
    "活动详情",
    "更多",
  ),
  route("activity-form", "new", "/activities/new", "新建活动", "更多"),
  route(
    "activity-form",
    "edit",
    "/activities/selected/edit",
    "编辑活动",
    "更多",
  ),
  route("more", "index", "/more", "更多", "更多"),
  route("settings", "density", "/settings", "显示设置", "更多"),
  route("setup", "warehouse", "/more?preview=setup", "仓库设置示例", "表单"),
  route(
    "recovery",
    "session",
    "/auth-complete?preview=recovery",
    "会话恢复示例",
    "更多",
    true,
  ),
  route("auth-complete", "session", "/auth-complete", "登录完成", "更多", true),
];

const pageMap = new Map(previewPages.map((page) => [page.key, page]));

export function getPreviewPage(key: string) {
  const registered = pageMap.get(key as PreviewPageKey);
  if (registered) return registered;
  const detail = /^activity-detail\/(ACT-[A-Za-z0-9-]+)$/.exec(key);
  if (detail)
    return route(
      "activity-detail",
      detail[1]!,
      `/activities/${encodeURIComponent(detail[1]!)}`,
      "活动详情",
      "更多",
    );
  const edit = /^activity-form\/edit-(ACT-[A-Za-z0-9-]+)$/.exec(key);
  if (edit)
    return route(
      "activity-form",
      `edit-${edit[1]}`,
      `/activities/${encodeURIComponent(edit[1]!)}/edit`,
      "编辑活动",
      "更多",
    );
  return undefined;
}

export function pageHash(key: PreviewPageKey) {
  return `#review/${encodeURIComponent(key)}`;
}

export function pageFromHash(hash: string) {
  const encoded = hash.match(/^#review\/(.+)$/)?.[1];
  if (!encoded) return undefined;
  try {
    return getPreviewPage(decodeURIComponent(encoded));
  } catch {
    return undefined;
  }
}

export type OperationKind =
  | "Receive"
  | "Issue"
  | "Transfer"
  | "Loan"
  | "Return"
  | "Damage"
  | "Loss"
  | "Repair"
  | "Disposal";
export type DraftKind = OperationKind | "Reconcile" | "Item";
export type DraftStatus = "draft" | "completed" | "cancelled";

export interface DraftLine {
  id: string;
  code: string;
  qty: number;
  uom: string;
  location: string;
  sourceLocation?: string;
  loanLineIndex?: number;
  loanName?: string;
  countState?: "counted";
  batch?: string;
  expiry?: string;
  countedQty?: number;
  manufacturingDate?: string;
  entryUom?: string;
  entryQty?: number;
  conversionFactor?: number;
  returnOutcome?: "returned" | "damaged" | "lost";
  reason?: string;
}

export interface ReviewDraft {
  documentType?: "Stock Entry" | "Stock Reconciliation" | "Item";
  saved?: boolean;
  amendedFrom?: string;
  version?: number;
  origin?: "frontend" | "desk";
  purpose?: string;
  postingTime?: string;
  timeMode?: "current" | "manual";
  countWarehouses?: string[];
  countMode?: "selective" | "full";
  baselineStale?: boolean;
  baselineReviewed?: boolean;
  files?: import("./workflowModel").PreviewAttachment[];
  name: string;
  kind: DraftKind;
  status: DraftStatus;
  postingDate: string;
  activity: string;
  borrower: string;
  note: string;
  source?: string;
  barcode?: string;
  description?: string;
  images?: string[];
  tracksBatch?: boolean;
  tracksExpiry?: boolean;
  loanName?: string;
  attachments?: string[];
  recorder?: string;
  handler?: string;
  reviewer?: string;
  itemCode?: string;
  itemName?: string;
  category?: string;
  uom?: string;
  lines: DraftLine[];
}

export interface ReviewMovement {
  lineId?: string;
  postingTime?: string;
  documentType?: string;
  stockPurpose?: string;
  loanLineIndex?: number;
  name: string;
  kind: string;
  docstatus: 0 | 1 | 2;
  date: string;
  code: string;
  itemName: string;
  qty: number;
  uom: string;
  from: string;
  to: string;
  borrower?: string;
  activity?: string;
  batch?: string;
  loanName?: string;
  bookQty?: number;
  countedQty?: number;
  manufacturingDate?: string;
  entryUom?: string;
  entryQty?: number;
  conversionFactor?: number;
  reason?: string;
}

export interface ReviewLoan {
  name: string;
  borrower: string;
  activity: string;
  loanDate: string;
  status: "outstanding" | "returned" | "damaged" | "lost" | "draft";
  lines: {
    code: string;
    qty: number;
    returned: number;
    damaged: number;
    lost: number;
    location?: string;
    batch?: string;
  }[];
}

export interface ReviewPending {
  name: string;
  kind: "damage";
  title: string;
  detail: string;
  location: string;
  qty: number;
  code?: string;
}

export interface ReviewWarehouse {
  name: string;
  label: string;
  parent?: string;
  is_group: boolean;
  warehouse_type: "Room" | "Location" | "Group";
  status: "active" | "inactive";
}

export interface ReviewFilters {
  movementScope: BrowseScope;
  loanScope: BrowseScope;
  dashboard: {
    categories: string[];
    warehouses: string[];
    period: PreviewPeriod;
    distribution: "warehouse" | "category";
    expiry: "expired" | "upcoming";
  };
  inventory: {
    scope: BrowseScope;
    search: string;
    category: string;
    warehouse: string;
    sort: "name" | "quantity";
    view: "card" | "table";
  };
  expiry: {
    search: string;
    status: "soon" | "expired" | "all" | "unexpired" | "undated";
    scope: BrowseScope;
    bucket: string;
    inStock: boolean;
  };
  movementItems: { search: string; sort: "newest" | "oldest" };
  movementRecords: {
    status: "draft" | "completed" | "cancelled";
    sort: "newest" | "oldest";
  };
  loanItems: {
    sort: "name" | "quantity";
    search: string;
    status: "all" | "outstanding" | "returned" | "damaged" | "lost";
  };
  loanRecords: {
    sort: "newest" | "oldest";
    status: "all" | "open" | "settled" | "draft";
  };
  pending: { search: string; scope: BrowseScope };
  drafts: { search: string };
  warehouses: { search: string };
}

const defaultWarehouses: ReviewWarehouse[] = [
  {
    name: "斋堂",
    label: "斋堂",
    is_group: true,
    warehouse_type: "Room",
    status: "active",
  },
  {
    name: locations[0],
    label: "A-01 · 米粮",
    parent: "斋堂",
    is_group: false,
    warehouse_type: "Location",
    status: "active",
  },
  {
    name: locations[1],
    label: "A-02 · 食品与用品",
    parent: "斋堂",
    is_group: false,
    warehouse_type: "Location",
    status: "active",
  },
  {
    name: "物资房",
    label: "物资房",
    is_group: true,
    warehouse_type: "Room",
    status: "active",
  },
  {
    name: locations[2],
    label: "B-01 · 衣物",
    parent: "物资房",
    is_group: false,
    warehouse_type: "Location",
    status: "active",
  },
  {
    name: "借出",
    label: "借出",
    is_group: false,
    warehouse_type: "Location",
    status: "active",
  },
  {
    name: "损坏待处理",
    label: "损坏待处理",
    is_group: true,
    warehouse_type: "Group",
    status: "active",
  },
  {
    name: "损坏待处理 / 斋堂",
    label: "斋堂损坏物资",
    parent: "损坏待处理",
    is_group: false,
    warehouse_type: "Location",
    status: "active",
  },
];

const defaultDrafts: ReviewDraft[] = [
  {
    name: "MAT-STE-2026-00002",
    kind: "Receive",
    status: "draft",
    postingDate: previewDate,
    activity: "ACT-0003",
    borrower: "",
    note: "",
    lines: [
      {
        id: "receive-1",
        code: "ITM-000128",
        qty: 12,
        uom: "袋",
        location: locations[0],
        batch: "RICE-2611",
        expiry: "2027-05-01",
      },
    ],
  },
  {
    name: "MAT-STE-2026-00001",
    kind: "Loan",
    status: "draft",
    postingDate: previewDate,
    activity: "",
    borrower: "法会义工组",
    note: "",
    lines: [
      {
        id: "loan-draft-1",
        code: "ITM-000130",
        qty: 2,
        uom: "件",
        location: locations[1],
        batch: "",
        expiry: "",
      },
    ],
  },
  {
    name: "MAT-RECO-2026-00015",
    kind: "Reconcile",
    status: "draft",
    postingDate: previewDate,
    activity: "ACT-0004",
    borrower: "",
    note: "复点签字后提交。",
    lines: [
      {
        id: "reconcile-1",
        code: "ITM-000131",
        qty: 48,
        countedQty: 47,
        uom: "个",
        location: locations[1],
        batch: "",
        expiry: "",
      },
    ],
  },
  {
    name: "PREV-ITEM-EDIT-001",
    kind: "Item",
    status: "draft",
    postingDate: previewDate,
    activity: "",
    borrower: "",
    note: "",
    itemCode: "ITM-000128",
    itemName: "东北珍珠米",
    category: "食品",
    uom: "袋",
    lines: [],
  },
];

const defaultMovements: ReviewMovement[] = [
  {
    name: "MAT-RECO-2026-00014",
    kind: "Opening",
    docstatus: 1,
    date: "2026-01-01",
    code: "ITM-000128",
    itemName: "东北珍珠米",
    qty: 128,
    uom: "袋",
    from: "期初",
    to: locations[0],
  },
  {
    name: "MAT-STE-2026-00017",
    kind: "Transfer",
    docstatus: 0,
    date: previewDate,
    code: "ITM-000133",
    itemName: "法会布幔与配套收纳袋",
    qty: 3,
    uom: "件",
    from: locations[2],
    to: locations[0],
    activity: "ACT-0005",
  },
  {
    name: "MAT-STE-2026-00003",
    kind: "Receive",
    docstatus: 1,
    date: "2026-10-09",
    code: "ITM-000129",
    itemName: "非转基因菜籽油 5L",
    qty: 6,
    uom: "桶",
    from: "捐赠",
    to: locations[1],
    activity: "ACT-0006",
  },
  {
    name: "MAT-STE-2026-00009",
    kind: "Receive",
    docstatus: 1,
    date: "2026-10-11",
    code: "ITM-000128",
    itemName: "东北珍珠米",
    qty: 12,
    uom: "袋",
    from: "—",
    to: locations[0],
    activity: "ACT-0003",
  },
  {
    name: "MAT-STE-2026-00004",
    loanName: "MAT-STE-2026-00004",
    loanLineIndex: 0,
    kind: "Loan",
    docstatus: 1,
    date: "2026-10-10",
    code: "ITM-000130",
    itemName: "义工纯棉工作服 · 秋冬长袖加厚款",
    qty: 4,
    uom: "件",
    from: locations[1],
    to: "借出",
    borrower: "法会义工组",
    activity: "ACT-0001",
  },
  {
    name: "MAT-STE-2026-00011",
    loanName: "MAT-STE-2026-00005",
    loanLineIndex: 0,
    kind: "Return",
    docstatus: 1,
    date: "2026-10-09",
    code: "ITM-000131",
    itemName: "食品级保鲜盒",
    qty: 2,
    uom: "个",
    from: "借出",
    to: locations[1],
    borrower: "斋堂义工",
  },
  {
    name: "MAT-STE-2026-00012",
    kind: "Transfer",
    docstatus: 0,
    date: "2026-10-11",
    code: "ITM-000133",
    itemName: "法会布幔与配套收纳袋",
    qty: 3,
    uom: "件",
    from: locations[2],
    to: locations[0],
    activity: "ACT-0005",
  },
  {
    name: "MAT-STE-2026-00013",
    kind: "Issue",
    docstatus: 2,
    date: "2026-10-08",
    code: "ITM-000129",
    itemName: "非转基因菜籽油 5L",
    qty: 1,
    uom: "桶",
    from: locations[1],
    to: "领用",
    activity: "ACT-0007",
  },
];

function initialDrafts(): ReviewDraft[] {
  const drafts = structuredClone(defaultDrafts);
  for (const row of defaultMovements.filter(
    (movement) => movement.docstatus === 0,
  )) {
    let draft = drafts.find((candidate) => candidate.name === row.name);
    if (!draft) {
      draft = {
        name: row.name,
        kind: row.kind as OperationKind,
        status: "draft",
        postingDate: row.date,
        activity: row.activity || "",
        borrower: row.borrower || "",
        note: "",
        lines: [],
      };
      drafts.push(draft);
    }
    draft.lines.push({
      id: `${row.name}-${draft.lines.length}`,
      code: row.code,
      qty: row.qty,
      uom: row.uom,
      sourceLocation: row.from,
      location: row.to,
    });
  }
  for (const draft of drafts) {
    draft.saved = true;
    draft.version = 1;
    draft.origin = "desk";
    draft.documentType =
      draft.kind === "Item"
        ? "Item"
        : draft.kind === "Reconcile"
          ? "Stock Reconciliation"
          : "Stock Entry";
    if (draft.kind === "Reconcile") {
      draft.countMode = "selective";
      draft.countWarehouses = [
        ...new Set(draft.lines.map((line) => line.location).filter(Boolean)),
      ];
      draft.baselineReviewed = true;
    }
  }
  return drafts;
}

const defaultLoans: ReviewLoan[] = [
  {
    name: "MAT-STE-2026-00007",
    borrower: "布置组",
    activity: "ACT-0008",
    loanDate: "2026-10-06",
    status: "lost",
    lines: [{ code: "ITM-000133", qty: 1, returned: 0, damaged: 0, lost: 1 }],
  },
  {
    name: "MAT-STE-2026-00004",
    borrower: "法会义工组",
    activity: "ACT-0001",
    loanDate: "2026-10-10",
    status: "outstanding",
    lines: [{ code: "ITM-000130", qty: 4, returned: 0, damaged: 0, lost: 0 }],
  },
  {
    name: "MAT-STE-2026-00005",
    borrower: "斋堂义工",
    activity: "ACT-0002",
    loanDate: "2026-10-08",
    status: "returned",
    lines: [{ code: "ITM-000131", qty: 2, returned: 2, damaged: 0, lost: 0 }],
  },
  {
    name: "MAT-STE-2026-00006",
    borrower: "清洁组",
    activity: "ACT-0009",
    loanDate: "2026-10-07",
    status: "damaged",
    lines: [{ code: "ITM-000133", qty: 1, returned: 0, damaged: 1, lost: 0 }],
  },
];

defaultLoans.forEach((loan) =>
  loan.lines.forEach((line) => {
    line.location = locations[1];
    line.batch = "";
  }),
);
defaultLoans.push({
  name: "MAT-STE-2026-00008",
  borrower: "接待组",
  activity: "ACT-0001",
  loanDate: "2026-10-09",
  status: "outstanding",
  lines: [
    {
      code: "ITM-000130",
      qty: 3,
      returned: 1,
      damaged: 1,
      lost: 0,
      location: locations[1],
      batch: "UNIFORM-2610",
    },
  ],
});
defaultMovements.push({
  name: "MAT-STE-2026-00009",
  kind: "Receive",
  docstatus: 1,
  date: "2026-10-11",
  code: "ITM-000129",
  itemName: "非转基因菜籽油 5L",
  qty: 3,
  uom: "桶",
  from: "捐赠",
  to: locations[1],
  batch: "OIL-2610",
  activity: "ACT-0003",
});

const defaultPending: ReviewPending[] = items.flatMap((item) =>
  item.locations
    .filter((location) => location.damaged > 0)
    .map((location, index) => ({
      name: `MAT-STE-2026-DMG-${item.code}-${index + 1}`,
      kind: "damage" as const,
      title: item.name,
      detail: `${location.damaged} ${item.uom}`,
      location: location.location,
      qty: location.damaged,
      code: item.code,
    })),
);

const seedStock = items.map((item) => structuredClone(item));

export interface ReviewSession {
  nativeBrowseQueries?: Record<
    string,
    import("../../src/lib/reportContract").ReportQuery
  >;
  categories: {
    name: string;
    label: string;
    parent?: string;
    is_group: boolean;
  }[];
  filters: ReviewFilters;
  selectedItems: string[];
  selectedItemCode: string;
  selectedMovementName: string;
  selectedLoanName: string;
  selectedReturnOutcome?: "returned" | "damaged";
  selectedSettlementLoan?: string;
  selectedAllocations?: import("../../src/lib/routeSelection").InitialAllocation[];
  nativeExpiryQuery?: import("../../src/lib/reportContract").ReportQuery;
  nativePendingQuery?: import("../../src/lib/reportContract").ReportQuery;
  selectedDraftName: string;
  selectedRecoveryId?: string;
  selectedOperationWarehouse?: string;
  selectedWarehouse: string;
  drafts: ReviewDraft[];
  movements: ReviewMovement[];
  loans: ReviewLoan[];
  pending: ReviewPending[];
  warehouses: ReviewWarehouse[];
  stock: StockItem[];
  units: { name: string; whole: boolean }[];
}

const sessionBaselines = new WeakMap<ReviewSession, StockItem[]>();
const sessionDraftSequences = new WeakMap<ReviewSession, number>();

const initialFilters = (): ReviewFilters => ({
  movementScope: emptyScope(),
  loanScope: emptyScope(),
  dashboard: {
    categories: [],
    warehouses: [],
    period: { key: "this_month", from: "", to: "" },
    distribution: "warehouse",
    expiry: "expired",
  },
  inventory: {
    scope: emptyScope(),
    search: "",
    category: "",
    warehouse: "",
    sort: "name",
    view: "card",
  },
  expiry: {
    search: "",
    status: "all",
    scope: emptyScope(),
    bucket: "",
    inStock: false,
  },
  movementItems: { search: "", sort: "newest" },
  movementRecords: { status: "completed", sort: "newest" },
  loanItems: { search: "", sort: "name", status: "outstanding" },
  loanRecords: { status: "all", sort: "newest" },
  pending: { search: "", scope: emptyScope() },
  drafts: { search: "" },
  warehouses: { search: "" },
});

const savedDocuments = new WeakMap<ReviewDraft, string>();
defaultMovements.forEach((row, index) => {
  row.lineId ||= `${row.name}/fixture-${index}`;
  row.postingTime ||= "09:30:00";
});

export function createReviewSession(
  stock: StockItem[] = items.map((item) => structuredClone(item)),
): ReviewSession {
  const session = reactive({
    categories: [
      { name: "全部物资", label: "全部物资", is_group: true },
      ...[...new Set(stock.map((item) => item.category))].map((name) => ({
        name,
        label: name,
        parent: "全部物资",
        is_group: false,
      })),
    ],
    filters: initialFilters(),
    selectedItems: [],
    selectedItemCode: "ITM-000128",
    selectedMovementName: "",
    selectedLoanName: "",
    selectedDraftName: "",
    selectedWarehouse: "斋堂",
    drafts: initialDrafts(),
    movements: structuredClone(
      defaultMovements.filter((row) => row.docstatus !== 0),
    ),
    loans: structuredClone(defaultLoans),
    pending: structuredClone(defaultPending),
    warehouses: structuredClone(defaultWarehouses),
    stock,
    units: [
      ...new Set([
        "Nos",
        ...stock.flatMap((item) => [
          item.uom,
          ...(item.alternateUnits?.map((row) => row.uom) || []),
        ]),
      ]),
    ].map((name) => ({
      name,
      whole: name === "Nos",
    })),
  }) as ReviewSession;
  sessionBaselines.set(
    session,
    stock.map((item) => structuredClone(item)),
  );
  session.nativeBrowseQueries = {};
  sessionDraftSequences.set(session, 1);
  session.drafts.forEach((draft) => captureSavedDraft(draft, session));
  return session;
}

export const reviewSession = createReviewSession(items);
export let reviewSessionGeneration = 0;

export function resetReviewSession(session: ReviewSession = reviewSession) {
  if (session === reviewSession) reviewSessionGeneration++;
  Object.assign(conversionAccess, {
    createUnit: true,
    updateItem: true,
    failSave: false,
    staleItem: false,
  });
  session.filters = initialFilters();
  session.categories = [
    { name: "全部物资", label: "全部物资", is_group: true },
    ...[
      ...new Set(
        (sessionBaselines.get(session) || items).map((item) => item.category),
      ),
    ].map((name) => ({
      name,
      label: name,
      parent: "全部物资",
      is_group: false,
    })),
  ];
  session.units = [
    ...new Set([
      "Nos",
      ...(sessionBaselines.get(session) || items).flatMap((item) => [
        item.uom,
        ...(item.alternateUnits?.map((row) => row.uom) || []),
      ]),
    ]),
  ].map((name) => ({ name, whole: name === "Nos" }));
  session.selectedItems = [];
  session.selectedItemCode = "ITM-000128";
  session.selectedMovementName = "";
  session.selectedLoanName = "";
  session.selectedReturnOutcome = undefined;
  session.selectedSettlementLoan = undefined;
  session.selectedAllocations = undefined;
  session.nativeExpiryQuery = undefined;
  session.nativePendingQuery = undefined;
  session.selectedRecoveryId = undefined;
  session.selectedOperationWarehouse = undefined;
  session.selectedDraftName = "";
  session.selectedWarehouse = "斋堂";
  session.drafts.splice(0, session.drafts.length, ...initialDrafts());
  session.movements.splice(
    0,
    session.movements.length,
    ...structuredClone(defaultMovements.filter((row) => row.docstatus !== 0)),
  );
  session.loans.splice(
    0,
    session.loans.length,
    ...structuredClone(defaultLoans),
  );
  session.pending.splice(
    0,
    session.pending.length,
    ...structuredClone(defaultPending),
  );
  session.warehouses.splice(
    0,
    session.warehouses.length,
    ...structuredClone(defaultWarehouses),
  );
  const baseline = sessionBaselines.get(session) || seedStock;
  session.stock.splice(0, session.stock.length, ...structuredClone(baseline));
  sessionDraftSequences.set(session, 1);
  session.drafts.forEach((draft) => captureSavedDraft(draft, session));
}

export function captureSavedDraft(draft: ReviewDraft, session?: ReviewSession) {
  if (!["Item", "Reconcile"].includes(draft.kind))
    draft.lines.forEach((line) => recordConversion(line, session));
  const snapshot = JSON.stringify(draft);
  savedDocuments.set(toRaw(draft), snapshot);
  return snapshot;
}
export function savedDraftSnapshot(draft: ReviewDraft) {
  return savedDocuments.get(toRaw(draft)) || captureSavedDraft(draft);
}

export function findDraft(
  kind: DraftKind,
  name?: string,
  session: ReviewSession = reviewSession,
) {
  return session.drafts.find(
    (draft) => draft.kind === kind && (!name || draft.name === name),
  );
}

export function createDraft(
  kind: DraftKind,
  name?: string,
  session: ReviewSession = reviewSession,
) {
  const existing = name
    ? findDraft(kind, name, session)
    : session.drafts.find(
        (draft) =>
          draft.kind === kind &&
          draft.status === "draft" &&
          !draft.name.startsWith("PREVIEW-RECEIVE-50"),
      );
  if (existing) {
    session.selectedDraftName = existing.name;
    return existing;
  }
  const sequence = sessionDraftSequences.get(session) || 1;
  const draft: ReviewDraft = {
    name:
      name ||
      `${kind === "Item" ? "ITEM-DRAFT" : kind === "Reconcile" ? "MAT-RECO" : "MAT-STE"}-2026-${String(sequence + 100).padStart(5, "0")}`,
    kind,
    documentType:
      kind === "Item"
        ? "Item"
        : kind === "Reconcile"
          ? "Stock Reconciliation"
          : "Stock Entry",
    saved: false,
    version: 1,
    origin: "frontend",
    uom: "Nos",
    timeMode: "current",
    postingTime: "09:00",
    status: "draft",
    postingDate: previewDate,
    activity: "",
    borrower: "",
    note: "",
    lines: [],
  };
  if (!name) sessionDraftSequences.set(session, sequence + 1);
  session.drafts.unshift(draft);
  session.selectedDraftName = draft.name;
  captureSavedDraft(session.drafts[0]!, session);
  return session.drafts[0]!;
}

export function updateDraft(
  kind: DraftKind,
  patch: Partial<Omit<ReviewDraft, "kind" | "name">>,
  name?: string,
  session: ReviewSession = reviewSession,
) {
  const draft =
    findDraft(kind, name, session) || createDraft(kind, name, session);
  Object.assign(draft, patch);
  if (draft.saved) captureSavedDraft(draft);
  return draft;
}

export function assignReceiptBatchIds(
  draft: ReviewDraft,
  session: ReviewSession = reviewSession,
) {
  if (draft.kind !== "Receive") return;
  draft.lines.forEach((line, index) => {
    if (
      session.stock.find((item) => item.code === line.code)?.tracksBatch &&
      !line.batch?.trim()
    )
      line.batch = `${draft.name}-${index + 1}`;
  });
}

/** Retain the contributing loan line when an item/batch spans locations. */
export function matchesLoanLine(
  line: DraftLine,
  borrowed: ReviewLoan["lines"][number],
  index: number,
) {
  return (
    borrowed.code === line.code &&
    (line.loanLineIndex === undefined
      ? (borrowed.batch || "") === (line.batch || "")
      : index === line.loanLineIndex)
  );
}

export function submitDraft(
  kind: DraftKind,
  name?: string,
  session: ReviewSession = reviewSession,
) {
  const draft = findDraft(kind, name, session);
  if (!draft) return undefined;
  if (draft.status !== "draft") return draft;
  if (
    kind === "Return" &&
    draft.lines.some((line) => line.returnOutcome === "lost")
  )
    return undefined;
  const linkedLoan = draft.loanName
    ? session.loans.find((loan) => loan.name === draft.loanName)
    : undefined;
  if (
    (kind === "Return" || draft.loanName) &&
    ["Return", "Damage", "Loss"].includes(kind) &&
    (!linkedLoan || !draft.lines.length)
  )
    return undefined;
  const settlement = ["Return", "Damage", "Loss"].includes(kind) && linkedLoan;
  if (settlement) {
    const requested = new Map<string, number>();
    const allocations: {
      borrowed: ReviewLoan["lines"][number];
      qty: number;
      outcome: "returned" | "damaged" | "lost";
    }[] = [];
    for (const line of draft.lines) {
      const loan = session.loans.find(
        (row) => row.name === (line.loanName || draft.loanName),
      );
      if (
        !loan ||
        loan.borrower !== draft.borrower ||
        loan.activity !== draft.activity ||
        !Number.isFinite(line.qty) ||
        line.qty <= 0
      )
        return undefined;
      const index =
        line.loanLineIndex ??
        loan.lines.findIndex((row, i) => matchesLoanLine(line, row, i));
      const borrowed = loan.lines[index];
      if (!borrowed || !matchesLoanLine(line, borrowed, index))
        return undefined;
      const key = `${loan.name}/${index}`;
      requested.set(key, (requested.get(key) || 0) + line.qty);
      if (
        requested.get(key)! >
        borrowed.qty - borrowed.returned - borrowed.damaged - borrowed.lost
      )
        return undefined;
      allocations.push({
        borrowed,
        qty: line.qty,
        outcome:
          kind === "Loss"
            ? "lost"
            : kind === "Damage"
              ? "damaged"
              : line.returnOutcome || "returned",
      });
    }
    for (const allocation of allocations)
      allocation.borrowed[allocation.outcome] += allocation.qty;
    for (const loan of session.loans)
      loan.status = loan.lines.some(
        (line) => line.qty > line.returned + line.damaged + line.lost,
      )
        ? "outstanding"
        : loan.lines.some((line) => line.lost)
          ? "lost"
          : loan.lines.some((line) => line.damaged)
            ? "damaged"
            : "returned";
  }
  if (draft.timeMode !== "manual") draft.postingTime = "10:30";
  draft.saved = true;
  draft.version = (draft.version || 1) + 1;
  assignReceiptBatchIds(draft, session);
  draft.status = "completed";
  if (kind === "Item") {
    const item = session.stock.find(
      (candidate) => candidate.code === draft.itemCode,
    );
    if (item) {
      item.barcode = draft.barcode;
      item.description = draft.description;
      item.images = draft.images;
      item.files = draft.files;
      item.name = draft.itemName?.trim() || item.name;
      item.category = draft.category?.trim() || item.category;
    }
  } else if (kind === "Reconcile") {
    draft.lines
      .filter(
        (line) =>
          line.countedQty !== undefined && String(line.countedQty) !== "",
      )
      .forEach((line) => {
        const item = session.stock.find(
          (candidate) => candidate.code === line.code,
        );
        if (!item) return;
        session.movements.unshift({
          lineId: line.id,
          postingTime: draft.postingTime,
          name: draft.name,
          kind: "Reconcile",
          docstatus: 1,
          date: draft.postingDate,
          code: item.code,
          itemName: item.name,
          qty: (line.countedQty ?? line.qty) - line.qty,
          bookQty: line.qty,
          countedQty: line.countedQty,
          reason: line.reason,
          uom: line.uom,
          from: "样本账面数量",
          to: line.location,
          activity: draft.activity || undefined,
        });
      });
  } else {
    if (kind === "Loan" && draft.lines.length) {
      session.loans.unshift({
        name: draft.name,
        borrower: draft.borrower,
        activity: draft.activity,
        loanDate: draft.postingDate,
        status: "outstanding",
        lines: draft.lines.map((line) => ({
          code: line.code,
          qty: line.qty,
          returned: 0,
          damaged: 0,
          lost: 0,
          location: line.sourceLocation || line.location,
          batch: line.batch,
        })),
      });
    }
    draft.lines.forEach((line) => {
      const item = session.stock.find(
        (candidate) => candidate.code === line.code,
      );
      if (!item) return;
      session.movements.unshift({
        lineId: line.id,
        postingTime: draft.postingTime,
        name: draft.name,
        kind:
          kind === "Return" && line.returnOutcome === "damaged"
            ? "Damage"
            : kind === "Return" && line.returnOutcome === "lost"
              ? "Loss"
              : kind,
        docstatus: 1,
        date: draft.postingDate,
        code: item.code,
        itemName: item.name,
        qty: line.qty,
        uom: line.uom,
        from: settlement
          ? "借出"
          : line.sourceLocation ||
            (kind === "Receive" ? draft.source || "—" : line.location),
        to:
          kind === "Loan"
            ? "借出"
            : kind === "Damage" || line.returnOutcome === "damaged"
              ? "损坏待处理 / 斋堂"
              : kind === "Loss" || line.returnOutcome === "lost"
                ? "遗失"
                : kind === "Disposal"
                  ? "报废"
                  : kind === "Issue"
                    ? "领用"
                    : line.location,
        batch: line.batch,
        entryUom: line.entryUom,
        entryQty: line.entryQty,
        conversionFactor: line.conversionFactor,
        manufacturingDate: line.manufacturingDate,
        loanLineIndex: line.loanLineIndex,
        reason: line.reason,
        loanName:
          kind === "Loan" ? draft.name : line.loanName || draft.loanName,
        borrower: draft.borrower || undefined,
        activity: draft.activity || undefined,
      });
    });
  }
  captureSavedDraft(draft);
  return draft;
}

export function warehouseFixtureNodes() {
  return reviewSession.warehouses.map((node) => ({ ...node }));
}

/** Editable drafts replace their imported rows; unclaimed Desk drafts remain visible. */
export function reviewMovementRows(
  session: ReviewSession = reviewSession,
): ReviewMovement[] {
  const drafts = session.drafts.filter(
    (draft) => draft.status === "draft" && draft.kind !== "Item",
  );
  return [
    ...session.movements
      .filter(
        (row) =>
          row.docstatus !== 0 ||
          !session.drafts.some((draft) => draft.name === row.name),
      )
      .map((row, index) => ({
        ...row,
        lineId: row.lineId || `${row.name}/${index}`,
        documentType:
          row.documentType ||
          (["Opening", "Reconcile"].includes(row.kind)
            ? "Stock Reconciliation"
            : "Stock Entry"),
      })),
    ...drafts.flatMap((draft): ReviewMovement[] => {
      const lines = draft.lines.length
        ? draft.lines
        : [{ code: "", qty: 0, uom: "", location: "" }];
      return lines.map((line, index) => ({
        lineId: "id" in line ? line.id : `${draft.name}/${index}`,
        name: draft.name,
        documentType: draft.documentType,
        kind: draft.kind,
        docstatus: 0,
        date: draft.postingDate,
        code: line.code,
        itemName:
          session.stock.find((item) => item.code === line.code)?.name ||
          "尚未添加物品",
        qty: line.qty,
        uom: line.uom,
        from: "sourceLocation" in line ? line.sourceLocation || "—" : "—",
        to: line.location || "—",
        activity: draft.activity,
        borrower: draft.borrower,
        loanName:
          "loanName" in line ? line.loanName || draft.loanName : draft.loanName,
        batch: "batch" in line ? line.batch : undefined,
        entryUom: "entryUom" in line ? line.entryUom : undefined,
        entryQty: "entryQty" in line ? line.entryQty : undefined,
        conversionFactor:
          "conversionFactor" in line ? line.conversionFactor : undefined,
        loanLineIndex: "loanLineIndex" in line ? line.loanLineIndex : undefined,
      }));
    }),
  ];
}
