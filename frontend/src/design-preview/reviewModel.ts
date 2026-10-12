import { reactive } from "vue";
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
  | "item-detail"
  | "item-form"
  | "movement-form"
  | "reconciliation-form"
  | "reports"
  | "report-export"
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
    "首页" | "库存" | "货物流动" | "借用" | "仓库" | "更多" | "报表" | "表单";
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
  route("inventory", "list", "/stock", "库存列表", "库存"),
  route("inventory", "filtered", "/stock", "筛选结果", "库存"),
  route("inventory", "empty", "/stock", "无匹配结果", "库存"),
  route("expiry", "soon", "/expiry", "即将到期", "库存"),
  route("expiry", "expired", "/expiry", "已过期", "库存"),
  route("expiry", "all", "/expiry", "全部批次", "库存"),
  route(
    "movement-items",
    "list",
    "/movements/items",
    "流动 · 按物品",
    "货物流动",
  ),
  route(
    "movement-items",
    "filtered",
    "/movements/items",
    "流动物品筛选",
    "货物流动",
  ),
  route(
    "movement-records",
    "draft",
    "/movements/records",
    "草稿记录",
    "货物流动",
  ),
  route(
    "movement-records",
    "completed",
    "/movements/records",
    "已完成记录",
    "货物流动",
  ),
  route(
    "movement-records",
    "cancelled",
    "/movements/records",
    "已取消记录",
    "货物流动",
  ),
  route(
    "movement-records",
    "detail",
    "/movements/records",
    "记录详情",
    "货物流动",
  ),
  route(
    "movement-records",
    "selected",
    "/movements/records",
    "选中记录详情",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "opening",
    "/movements/records",
    "期初记录详情",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "workspace-detail",
    "/workspace/PREV-WORKSPACE-001",
    "工作区记录详情",
    "货物流动",
    true,
  ),
  route(
    "movement-records",
    "entry-detail",
    "/entry/PREV-ENTRY-001",
    "库存分录详情",
    "货物流动",
    true,
  ),
  route("loan-items", "outstanding", "/loans/items", "未归还 · 按物品", "借用"),
  route("loan-items", "returned", "/loans/items", "已归还 · 按物品", "借用"),
  route("loan-items", "damaged", "/loans/items", "损坏 · 按物品", "借用"),
  route("loan-items", "lost", "/loans/items", "遗失 · 按物品", "借用"),
  route("loan-records", "all", "/loans/records", "全部借用记录", "借用"),
  route("loan-items", "all", "/loans/items", "全部借用物品", "借用"),
  route("loan-records", "open", "/loans/records", "未结清记录", "借用"),
  route("loan-records", "settled", "/loans/records", "已结清记录", "借用"),
  route("loan-records", "draft", "/loans/records", "借用草稿", "借用"),
  route("loan-records", "detail", "/loans/records", "借用记录详情", "借用"),
  route(
    "loan-detail",
    "outstanding",
    "/loans/PREV-LOAN-001",
    "待归还借用",
    "借用",
  ),
  route(
    "loan-detail",
    "returned",
    "/loans/PREV-LOAN-002",
    "已归还借用",
    "借用",
  ),
  route(
    "loan-detail",
    "damaged",
    "/loans/PREV-LOAN-003",
    "损坏结清借用",
    "借用",
  ),
  route(
    "loan-detail",
    "selected",
    "/loans/PREV-LOAN-001",
    "选中借用记录详情",
    "借用",
    true,
  ),
  route("warehouses", "tree", "/warehouses", "仓库树", "库存"),
  route("warehouses", "create", "/warehouses", "新建仓库", "库存"),
  route("warehouses", "edit", "/warehouses", "编辑仓库", "库存"),
  route("warehouse-detail", "overview", "/warehouses/斋堂", "仓库详情", "库存"),
  route("warehouse-detail", "edit", "/warehouses/斋堂", "编辑仓库详情", "库存"),
  route("pending", "actionable", "/pending", "损坏待处理", "库存"),
  route("drafts", "open", "/drafts", "草稿", "更多"),
  route("item-detail", "overview", "/item/ITM-000128", "物品详情", "库存"),
  route("item-detail", "batches", "/item/ITM-000128", "物品批次", "库存"),
  route("item-form", "new", "/items/new", "新建物品", "表单"),
  route(
    "item-form",
    "edit",
    "/items/new?preview=edit&code=ITM-000128",
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
      `/new/${kind}`,
      `${{ Receive: "入库", Issue: "出库", Transfer: "转移", Loan: "借出", Return: "归还", Damage: "标记损坏", Loss: "记录遗失", Repair: "修复归库", Disposal: "正式报废" }[kind]}登记`,
      "表单",
    ),
  ),
  route("reconciliation-form", "new", "/reconcile/new", "新建盘点", "表单"),
  route(
    "reconciliation-form",
    "detail",
    "/reconcile/PREV-RECON-001",
    "盘点记录详情",
    "表单",
  ),
  route("reports", "overview", "/reports", "报表与导出", "报表"),
  ...Object.entries({
    movement: "货物流动汇总",
    movement_records: "流动记录报表",
    current_stock: "当前库存报表",
    warehouse_stock: "仓库库存报表",
    expiry: "效期风险报表",
  }).map(([variant, label]) =>
    route("reports", variant, `/reports?type=${variant}`, label, "报表"),
  ),
  route(
    "report-export",
    "preview",
    "/reports?preview=export",
    "报表导出预览",
    "报表",
  ),
  route("more", "index", "/more", "工具", "更多"),
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
  return pageMap.get(key as PreviewPageKey);
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
  batch?: string;
  expiry?: string;
  countedQty?: number;
}

export interface ReviewDraft {
  name: string;
  kind: DraftKind;
  status: DraftStatus;
  postingDate: string;
  activity: string;
  borrower: string;
  responsible: string;
  note: string;
  loanName?: string;
  attachments?: string[];
  itemCode?: string;
  itemName?: string;
  category?: string;
  uom?: string;
  lines: DraftLine[];
}

export interface ReviewMovement {
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
    status: "soon" | "expired" | "all";
    scope: BrowseScope;
    bucket: string;
    inStock: boolean;
  };
  movementItems: { search: string; sort: "newest" | "oldest" };
  movementRecords: {
    status: "draft" | "completed" | "cancelled";
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
    is_group: true,
    warehouse_type: "Group",
    status: "active",
  },
  {
    name: "借出 / 法会义工组",
    label: "法会义工组",
    parent: "借出",
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
    name: "PREV-DRAFT-RECEIVE-001",
    kind: "Receive",
    status: "draft",
    postingDate: previewDate,
    activity: "秋季斋堂补给",
    borrower: "",
    responsible: "义工组",
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
    name: "PREV-DRAFT-LOAN-001",
    kind: "Loan",
    status: "draft",
    postingDate: previewDate,
    activity: "",
    borrower: "法会义工组",
    responsible: "值班义工",
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
    name: "PREV-RECON-001",
    kind: "Reconcile",
    status: "draft",
    postingDate: previewDate,
    activity: "物资房月度盘点",
    borrower: "",
    responsible: "盘点小组",
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
    responsible: "",
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
    name: "PREV-OPENING-001",
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
    name: "PREV-WORKSPACE-001",
    kind: "Transfer",
    docstatus: 0,
    date: previewDate,
    code: "ITM-000133",
    itemName: "法会布幔与配套收纳袋",
    qty: 3,
    uom: "件",
    from: locations[2],
    to: locations[0],
    activity: "秋季法会布置",
  },
  {
    name: "PREV-ENTRY-001",
    kind: "Receive",
    docstatus: 1,
    date: "2026-10-09",
    code: "ITM-000129",
    itemName: "非转基因菜籽油 5L",
    qty: 6,
    uom: "桶",
    from: "捐赠",
    to: locations[1],
    activity: "厨房补给",
  },
  {
    name: "PREV-MOV-001",
    kind: "Receive",
    docstatus: 1,
    date: "2026-10-11",
    code: "ITM-000128",
    itemName: "东北珍珠米",
    qty: 12,
    uom: "袋",
    from: "—",
    to: locations[0],
    activity: "秋季斋堂补给",
  },
  {
    name: "PREV-MOV-002",
    loanName: "PREV-LOAN-001",
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
    activity: "秋季法会",
  },
  {
    name: "PREV-MOV-003",
    loanName: "PREV-LOAN-002",
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
    name: "PREV-MOV-004",
    kind: "Transfer",
    docstatus: 0,
    date: "2026-10-11",
    code: "ITM-000133",
    itemName: "法会布幔与配套收纳袋",
    qty: 3,
    uom: "件",
    from: locations[2],
    to: locations[0],
    activity: "秋季法会布置",
  },
  {
    name: "PREV-MOV-005",
    kind: "Issue",
    docstatus: 2,
    date: "2026-10-08",
    code: "ITM-000129",
    itemName: "非转基因菜籽油 5L",
    qty: 1,
    uom: "桶",
    from: locations[1],
    to: "领用",
    activity: "厨房备餐",
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
        responsible: "",
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
  return drafts;
}

const defaultLoans: ReviewLoan[] = [
  {
    name: "PREV-LOAN-004",
    borrower: "布置组",
    activity: "法会收场",
    loanDate: "2026-10-06",
    status: "lost",
    lines: [{ code: "ITM-000133", qty: 1, returned: 0, damaged: 0, lost: 1 }],
  },
  {
    name: "PREV-LOAN-001",
    borrower: "法会义工组",
    activity: "秋季法会",
    loanDate: "2026-10-10",
    status: "outstanding",
    lines: [{ code: "ITM-000130", qty: 4, returned: 0, damaged: 0, lost: 0 }],
  },
  {
    name: "PREV-LOAN-002",
    borrower: "斋堂义工",
    activity: "日常供餐",
    loanDate: "2026-10-08",
    status: "returned",
    lines: [{ code: "ITM-000131", qty: 2, returned: 2, damaged: 0, lost: 0 }],
  },
  {
    name: "PREV-LOAN-003",
    borrower: "清洁组",
    activity: "库房整理",
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
  name: "PREV-LOAN-005",
  borrower: "接待组",
  activity: "秋季法会",
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
  name: "PREV-MOV-001",
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
  activity: "秋季斋堂补给",
});

const defaultPending: ReviewPending[] = items.flatMap((item) =>
  item.locations
    .filter((location) => location.damaged > 0)
    .map((location, index) => ({
      name: `PREV-PENDING-DAMAGE-${item.code}-${index + 1}`,
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
  filters: ReviewFilters;
  selectedItems: string[];
  selectedItemCode: string;
  selectedMovementName: string;
  selectedLoanName: string;
  selectedDraftName: string;
  selectedWarehouse: string;
  drafts: ReviewDraft[];
  movements: ReviewMovement[];
  loans: ReviewLoan[];
  pending: ReviewPending[];
  warehouses: ReviewWarehouse[];
  stock: StockItem[];
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
    status: "soon",
    scope: emptyScope(),
    bucket: "",
    inStock: false,
  },
  movementItems: { search: "", sort: "newest" },
  movementRecords: { status: "completed" },
  loanItems: { search: "", sort: "name", status: "outstanding" },
  loanRecords: { status: "all", sort: "newest" },
  pending: { search: "", scope: emptyScope() },
  drafts: { search: "" },
});

export function createReviewSession(
  stock: StockItem[] = items.map((item) => structuredClone(item)),
): ReviewSession {
  const session = reactive({
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
  }) as ReviewSession;
  sessionBaselines.set(
    session,
    stock.map((item) => structuredClone(item)),
  );
  sessionDraftSequences.set(session, 1);
  return session;
}

export const reviewSession = createReviewSession(items);

export function resetReviewSession(session: ReviewSession = reviewSession) {
  session.filters = initialFilters();
  session.selectedItems = [];
  session.selectedItemCode = "ITM-000128";
  session.selectedMovementName = "";
  session.selectedLoanName = "";
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
        (draft) => draft.kind === kind && draft.status === "draft",
      );
  if (existing) {
    session.selectedDraftName = existing.name;
    return existing;
  }
  const sequence = sessionDraftSequences.get(session) || 1;
  const draft: ReviewDraft = {
    name:
      name || `PREV-${kind.toUpperCase()}-${String(sequence).padStart(3, "0")}`,
    kind,
    status: "draft",
    postingDate: previewDate,
    activity: "",
    borrower: "",
    responsible: "",
    note: "",
    lines: [],
  };
  if (!name) sessionDraftSequences.set(session, sequence + 1);
  session.drafts.unshift(draft);
  session.selectedDraftName = draft.name;
  return draft;
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
  return draft;
}

export function submitDraft(
  kind: DraftKind,
  name?: string,
  session: ReviewSession = reviewSession,
) {
  const draft = findDraft(kind, name, session);
  if (!draft) return undefined;
  if (draft.status !== "draft") return draft;
  const linkedLoan = draft.loanName
    ? session.loans.find((loan) => loan.name === draft.loanName)
    : undefined;
  const settlement = ["Return", "Damage", "Loss"].includes(kind) && linkedLoan;
  if (settlement) {
    for (const code of new Set(draft.lines.map((line) => line.code))) {
      const available = linkedLoan.lines
        .filter((line) => line.code === code)
        .reduce(
          (sum, line) =>
            sum +
            Math.max(0, line.qty - line.returned - line.damaged - line.lost),
          0,
        );
      const requested = draft.lines
        .filter((line) => line.code === code)
        .reduce((sum, line) => sum + line.qty, 0);
      if (requested > available || requested <= 0) return undefined;
    }
    for (const line of draft.lines) {
      let rest = line.qty;
      for (const borrowed of linkedLoan.lines.filter(
        (row) => row.code === line.code,
      )) {
        const qty = Math.min(
          rest,
          Math.max(
            0,
            borrowed.qty - borrowed.returned - borrowed.damaged - borrowed.lost,
          ),
        );
        borrowed[
          kind === "Return"
            ? "returned"
            : kind === "Damage"
              ? "damaged"
              : "lost"
        ] += qty;
        rest -= qty;
      }
    }
    linkedLoan.status = linkedLoan.lines.some(
      (line) => line.qty > line.returned + line.damaged + line.lost,
    )
      ? "outstanding"
      : linkedLoan.lines.some((line) => line.lost > 0)
        ? "lost"
        : linkedLoan.lines.some((line) => line.damaged > 0)
          ? "damaged"
          : "returned";
  }
  draft.status = "completed";
  if (kind === "Item") {
    const item = session.stock.find(
      (candidate) => candidate.code === draft.itemCode,
    );
    if (item) {
      item.name = draft.itemName?.trim() || item.name;
      item.category = draft.category?.trim() || item.category;
      item.uom = draft.uom?.trim() || item.uom;
    }
  } else if (kind === "Reconcile") {
    draft.lines.forEach((line) => {
      const item = session.stock.find(
        (candidate) => candidate.code === line.code,
      );
      if (!item) return;
      session.movements.unshift({
        name: draft.name,
        kind: "Reconcile",
        docstatus: 1,
        date: draft.postingDate,
        code: item.code,
        itemName: item.name,
        qty: line.countedQty ?? line.qty,
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
        name: draft.name,
        kind,
        docstatus: 1,
        date: draft.postingDate,
        code: item.code,
        itemName: item.name,
        qty: line.qty,
        uom: line.uom,
        from: line.sourceLocation || (kind === "Receive" ? "—" : line.location),
        to:
          kind === "Issue" || kind === "Loss" || kind === "Disposal"
            ? "领用"
            : line.location,
        batch: line.batch,
        loanName: kind === "Loan" ? draft.name : draft.loanName,
        borrower: draft.borrower || undefined,
        activity: draft.activity || undefined,
      });
    });
  }
  return draft;
}

export function warehouseFixtureNodes() {
  return reviewSession.warehouses.map((node) => ({ ...node }));
}

/** Draft rows are projections of editable state, never a second draft store. */
export function reviewMovementRows(
  session: ReviewSession = reviewSession,
): ReviewMovement[] {
  const drafts = session.drafts.filter(
    (draft) => draft.status === "draft" && draft.kind !== "Item",
  );
  return [
    ...session.movements.filter((row) => row.docstatus !== 0),
    ...drafts.flatMap((draft): ReviewMovement[] => {
      const lines = draft.lines.length
        ? draft.lines
        : [{ code: "", qty: 0, uom: "", location: "" }];
      return lines.map((line) => ({
        name: draft.name,
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
        loanName: draft.loanName,
        batch: "batch" in line ? line.batch : undefined,
      }));
    }),
  ];
}
