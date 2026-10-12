import { reactive } from "vue";
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
  group: "首页" | "库存" | "货物流动" | "借用" | "仓库" | "更多" | "表单";
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
  route("movement-items", "list", "/movements/items", "流动明细", "货物流动"),
  route(
    "movement-items",
    "filtered",
    "/movements/items",
    "筛选明细",
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
  route("loan-items", "outstanding", "/loans/items", "未归还明细", "借用"),
  route("loan-items", "returned", "/loans/items", "已归还明细", "借用"),
  route("loan-items", "damaged", "/loans/items", "损坏明细", "借用"),
  route("loan-items", "lost", "/loans/items", "遗失明细", "借用"),
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
  route("warehouses", "tree", "/warehouses", "仓库树", "仓库"),
  route("warehouses", "create", "/warehouses", "新建仓库", "仓库"),
  route("warehouses", "edit", "/warehouses", "编辑仓库", "仓库"),
  route("warehouse-detail", "overview", "/warehouses/斋堂", "仓库详情", "仓库"),
  route("warehouse-detail", "edit", "/warehouses/斋堂", "编辑仓库详情", "仓库"),
  route("pending", "actionable", "/pending", "待处理", "更多"),
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
  route("reports", "overview", "/reports", "报表与导出", "更多"),
  ...Object.entries({
    movement: "货物流动汇总",
    movement_records: "流动记录报表",
    current_stock: "当前库存报表",
    warehouse_stock: "仓库库存报表",
    expiry: "效期风险报表",
  }).map(([variant, label]) =>
    route("reports", variant, `/reports?type=${variant}`, label, "更多"),
  ),
  route(
    "report-export",
    "preview",
    "/reports?preview=export",
    "报表导出预览",
    "表单",
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
  dashboard: { category: string; warehouse: string };
  inventory: {
    search: string;
    category: string;
    warehouse: string;
    sort: "name" | "quantity";
    view: "card" | "table";
  };
  expiry: { search: string; status: "soon" | "expired" | "all" };
  movementItems: { search: string; kind: string };
  movementRecords: {
    search: string;
    status: "all" | "draft" | "completed" | "cancelled";
  };
  loanItems: {
    search: string;
    status: "outstanding" | "returned" | "damaged" | "lost";
  };
  loanRecords: { search: string; status: "all" | "open" | "settled" | "draft" };
  pending: { search: string };
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
  dashboard: { category: "", warehouse: "" },
  inventory: {
    search: "",
    category: "",
    warehouse: "",
    sort: "name",
    view: "card",
  },
  expiry: { search: "", status: "soon" },
  movementItems: { search: "", kind: "" },
  movementRecords: { search: "", status: "all" },
  loanItems: { search: "", status: "outstanding" },
  loanRecords: { search: "", status: "all" },
  pending: { search: "" },
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
    drafts: structuredClone(defaultDrafts),
    movements: structuredClone(defaultMovements),
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
  session.drafts.splice(
    0,
    session.drafts.length,
    ...structuredClone(defaultDrafts),
  );
  session.movements.splice(
    0,
    session.movements.length,
    ...structuredClone(defaultMovements),
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
