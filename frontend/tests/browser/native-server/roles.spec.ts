import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Real logins for the four role presets against a live site: no response is mocked.
// Also the Sample smoke: NATIVE_BASE_URL=https://sample.kufang.online.
// ROLE_SHOTS_DIR saves every reviewed page at 1440, 1024 and 390.
const password = process.env.NATIVE_ROLE_PASSWORD || "admin";
const shots = process.env.ROLE_SHOTS_DIR;
const baseURL = process.env.NATIVE_BASE_URL || "http://127.0.0.1:8101";

type Key = "viewer" | "operator" | "manager" | "admin";
const accounts: Record<Key, { user: string; label: string }> = {
  viewer: { user: "viewer@example.com", label: "只读" },
  operator: { user: "operator@example.com", label: "录入员" },
  manager: { user: "manager@example.com", label: "负责人" },
  admin: { user: "inventory.admin@example.com", label: "管理员" },
};
// Capability leaf -> the accounts that must have it. Everything else must be false.
const grants: Record<string, Key[]> = {
  "stock_entry.read": ["viewer", "operator", "manager", "admin"],
  "stock_entry.create": ["operator", "manager", "admin"],
  "stock_entry.submit": ["operator", "manager", "admin"],
  "stock_entry.cancel": ["manager", "admin"],
  "stock_entry.amend": ["manager", "admin"],
  "stock_entry.delete": ["manager", "admin"],
  "stock_reconciliation.read": ["viewer", "operator", "manager", "admin"],
  "stock_reconciliation.create": ["manager", "admin"],
  "stock_reconciliation.submit": ["manager", "admin"],
  "item.create": ["operator", "manager", "admin"],
  "item.write": ["operator", "manager", "admin"],
  "item.delete": ["admin"],
  "activity.create": ["operator", "manager", "admin"],
  "activity.delete": ["admin"],
  "item_group.create": ["manager", "admin"],
  "uom.create": ["manager", "admin"],
  "activity_type.create": ["manager", "admin"],
  "warehouse.create": ["admin"],
  "warehouse.write": ["admin"],
  "settings.write": ["admin"],
  "imports.create": ["manager", "admin"],
};

interface Session {
  page: Page;
  csrf: string;
  user: string;
  info: Record<string, any>;
  post(
    method: string,
    data?: object,
  ): Promise<{ status: number; body: Record<string, any> }>;
  ok(method: string, data?: object): Promise<any>;
  denied(method: string, data?: object): Promise<void>;
  close(): Promise<void>;
}

async function login(browser: Browser, key: Key, width = 1440, height = 1000) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const response = await page.request.post("/api/method/login", {
    form: { usr: accounts[key].user, pwd: password },
  });
  expect(response.ok(), `login ${key}`).toBe(true);
  const session = await page.request.get(
    "/api/method/temple_inventory.session.info",
  );
  expect(session.ok(), `session ${key}`).toBe(true);
  const info = (await session.json()).message;
  const post: Session["post"] = async (method, data = {}) => {
    const reply = await page.request.post(
      `/api/method/temple_inventory.${method}`,
      {
        data,
        headers: {
          "X-Frappe-CSRF-Token": info.csrf_token,
          "X-Inventory-Account": info.user,
        },
      },
    );
    return { status: reply.status(), body: await reply.json() };
  };
  return {
    page,
    csrf: info.csrf_token,
    user: info.user,
    info,
    post,
    async ok(method: string, data = {}) {
      const { status, body } = await post(method, data);
      expect(status, `${key} ${method}: ${JSON.stringify(body)}`).toBe(200);
      return body.message;
    },
    async denied(method: string, data = {}) {
      const { status, body } = await post(method, data);
      expect(status, `${key} ${method} must be refused`).toBe(403);
      expect(body.exc_type).toBe("PermissionError");
    },
    close: () => context.close(),
  } as Session;
}

async function firstName(session: Session, doctype: string, docstatus: number) {
  const filters = encodeURIComponent(
    JSON.stringify([["docstatus", "=", docstatus]]),
  );
  const reply = await session.page.request.get(
    `/api/resource/${encodeURIComponent(doctype)}?filters=${filters}&limit_page_length=1`,
  );
  expect(reply.ok(), `${doctype} list`).toBe(true);
  return (await reply.json()).data[0]?.name as string | undefined;
}

async function loaded(page: Page) {
  await expect(page.locator(".skeleton, [aria-busy='true']").first())
    .toHaveCount(0, { timeout: 30000 })
    .catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function open(page: Page, path: string) {
  await page.goto(`/inventory${path}`);
  await loaded(page);
}

const primaryNav = (page: Page) =>
  page.getByRole("navigation").getByText("货物流动").first();

test.beforeAll(() => {
  test.skip(
    !process.env.NATIVE_BASE_URL,
    "Requires a live site with the four demo accounts",
  );
  if (shots) mkdirSync(shots, { recursive: true });
});

for (const key of Object.keys(accounts) as Key[]) {
  test(`${key}: session reports the native role and capabilities`, async ({
    browser,
  }) => {
    const session = await login(browser, key);
    expect(session.info.role_label).toBe(accounts[key].label);
    for (const [leaf, holders] of Object.entries(grants)) {
      const [domain, permission] = leaf.split(".") as [string, string];
      expect(
        session.info.capabilities[domain][permission],
        `${key} ${leaf}`,
      ).toBe(holders.includes(key));
    }
    await session.close();
  });
}

test("an account with no inventory role sees the no-access page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const response = await page.request.post("/api/method/login", {
    form: { usr: "noaccess@example.com", pwd: password },
  });
  expect(response.ok()).toBe(true);
  const session = await page.request.get(
    "/api/method/temple_inventory.session.info",
  );
  expect(session.status()).toBe(403);
  await page.goto("/inventory");
  await expect(page.getByText("尚未分配物资管理角色")).toBeVisible();
  await context.close();
});

test("direct API calls are refused per role", async ({ browser }) => {
  const viewer = await login(browser, "viewer");
  const operator = await login(browser, "operator");
  const manager = await login(browser, "manager");
  const boot = await viewer.ok("browse.bootstrap");
  const warehouse = (boot.physical_leaves as string[])[0]!;
  const line = {
    item_code: "NOT-CREATED",
    qty: 1,
    uom: "Nos",
    conversion_factor: 1,
    t_warehouse: warehouse,
  };
  const entry = {
    company: boot.company,
    posting_date: boot.site_date,
    ti_movement_kind: "Receive",
    items: [line],
  };
  await viewer.denied("catalog.save_item", {
    data: { item_name: "viewer denied", stock_uom: "Nos" },
  });
  await viewer.denied("native_api.create_document", {
    doctype: "Stock Entry",
    request_id: crypto.randomUUID(),
    data: entry,
  });
  await viewer.denied("activities.save_activity", {
    data: { title: "viewer denied" },
  });
  await operator.denied("counts.save_count", {
    request_id: crypto.randomUUID(),
    data: { ti_count_review: [] },
  });
  await operator.denied("native_api.create_document", {
    doctype: "Stock Reconciliation",
    request_id: crypto.randomUUID(),
    data: { company: boot.company, items: [] },
  });
  await operator.denied("catalog.create_category", {
    label: "operator denied",
  });
  await manager.denied("warehouses.create_location", {
    parent: warehouse,
    label: "manager denied",
    kind: "Shelf",
  });
  for (const endpoint of [
    "item_template",
    "upload",
    "preview",
    "commit",
    "status",
    "report",
    "item_catalog",
    "retry",
  ])
    await operator.denied(
      `imports.${endpoint}`,
      endpoint === "upload" ? {} : { name: "missing", plan_hash: "missing" },
    );
  await viewer.close();
  await operator.close();
  await manager.close();
});

test("operator records stock; only a manager reverses it", async ({
  browser,
}) => {
  const operator = await login(browser, "operator");
  const manager = await login(browser, "manager");
  const boot = await operator.ok("browse.bootstrap");
  const warehouse = (boot.physical_leaves as string[])[0]!;
  const saved = await operator.ok("catalog.save_item", {
    data: {
      item_name: `角色验收 ${crypto.randomUUID().slice(0, 8)}`,
      stock_uom: "Nos",
    },
  });
  const code = saved.item_code || saved.name;
  const entry = (request_id: string) => ({
    doctype: "Stock Entry",
    request_id,
    data: {
      company: boot.company,
      posting_date: boot.site_date,
      ti_movement_kind: "Receive",
      items: [
        {
          item_code: code,
          qty: 2,
          uom: "Nos",
          conversion_factor: 1,
          t_warehouse: warehouse,
        },
      ],
    },
  });
  const draft = await operator.ok(
    "native_api.create_document",
    entry(crypto.randomUUID()),
  );
  expect(draft.actions).toMatchObject({
    edit: true,
    submit: true,
    delete: false,
  });
  await operator.denied("native_api.delete_document", {
    doctype: "Stock Entry",
    name: draft.name,
    version: draft.version,
  });
  const submitted = await operator.ok("native_api.submit_document", {
    doctype: "Stock Entry",
    name: draft.name,
    version: draft.version,
  });
  expect(submitted.docstatus).toBe(1);
  expect(submitted.actions.cancel).toBe(false);
  await operator.denied("native_api.cancel_document", {
    doctype: "Stock Entry",
    name: submitted.name,
    version: submitted.version,
  });
  const reloaded = await manager.ok("native_api.load_document", {
    doctype: "Stock Entry",
    name: submitted.name,
  });
  expect(reloaded.actions.cancel).toBe(true);
  const cancelled = await manager.ok("native_api.cancel_document", {
    doctype: "Stock Entry",
    name: submitted.name,
    version: reloaded.version,
  });
  expect(cancelled.docstatus).toBe(2);
  expect(cancelled.actions.amend).toBe(true);
  await operator.close();
  await manager.close();
});

test("viewer browses and exports with no write offered", async ({
  browser,
}) => {
  const viewer = await login(browser, "viewer");
  const { page } = viewer;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      /native_api\.(save|create|submit)|counts\.save_count/.test(request.url())
    )
      writes.push(request.url());
  });
  await open(page, "/stock");
  await expect(primaryNav(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /新建物品/ })).toHaveCount(0);
  const name = await firstName(viewer, "Stock Entry", 1);
  expect(name, "a submitted Stock Entry").toBeTruthy();
  await open(page, `/movements/${encodeURIComponent(name!)}`);
  for (const label of ["取消", "修订", "确认", "删除草稿"])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  const draft = await firstName(viewer, "Stock Entry", 0);
  if (draft) {
    await open(page, `/movements/${encodeURIComponent(draft)}`);
    await page.waitForTimeout(1500);
  }
  expect(writes, "a read-only view must never autosave").toEqual([]);
  for (const path of [
    "/movements/new/Receive",
    "/counts/new",
    "/stock/items/new",
  ]) {
    await open(page, path);
    await expect(page.getByTestId("forbidden-state"), path).toBeVisible();
    await expect(primaryNav(page), path).toBeVisible();
  }
  const started = await viewer.ok("exports.request_export", {
    query: { dataset: "inventory", view: "summary" },
    table: "summary",
    export_format: "csv",
  });
  await expect
    .poll(
      async () =>
        (await viewer.ok("exports.export_status", { name: started.name }))
          .status,
      { timeout: 90000, intervals: [2000] },
    )
    .toBe("Completed");
  await viewer.close();
});

test("operator keeps counts read-only and movements usable", async ({
  browser,
}) => {
  const operator = await login(browser, "operator");
  const { page } = operator;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/counts\.save_count/.test(request.url())) writes.push(request.url());
  });
  await open(page, "/counts/new");
  await expect(page.getByTestId("forbidden-state")).toBeVisible();
  await open(page, "/counts/opening/new");
  await expect(page.getByTestId("forbidden-state")).toBeVisible();
  await open(page, "/counts");
  await expect(page.getByTestId("forbidden-state")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /新建盘点|开始盘点/ }),
  ).toHaveCount(0);
  const draft = await firstName(operator, "Stock Reconciliation", 0);
  if (draft) {
    await open(page, `/counts/${encodeURIComponent(draft)}`);
    await expect(page.getByRole("button", { name: "复核并确认" })).toHaveCount(
      0,
    );
    await page.waitForTimeout(1500);
  }
  expect(writes).toEqual([]);
  await open(page, "/movements/new/Receive");
  await expect(page.getByTestId("forbidden-state")).toHaveCount(0);
  await operator.close();
});

test("manager sees counts and reversal but no warehouse writes", async ({
  browser,
}) => {
  const manager = await login(browser, "manager");
  const { page } = manager;
  await open(page, "/counts/new");
  await expect(page.getByTestId("forbidden-state")).toHaveCount(0);
  const tree = await manager.ok("warehouses.tree");
  expect(tree.can_create).toBe(false);
  await open(page, "/stock/warehouses");
  await expect(page.getByRole("button", { name: /添加/ })).toHaveCount(0);
  await manager.close();
});

test("manager creates and submits Opening Stock over HTTP; operator create is refused", async ({
  browser,
}) => {
  const operator = await login(browser, "operator");
  const manager = await login(browser, "manager");
  const boot = await operator.ok("browse.bootstrap");
  const item = await operator.ok("catalog.save_item", {
    data: {
      item_name: `期初验收 ${crypto.randomUUID().slice(0, 8)}`,
      stock_uom: "Nos",
    },
  });
  const code = item.item_code || item.name;
  const data = {
    company: boot.company,
    purpose: "Opening Stock",
    posting_date: boot.site_date,
    posting_time: String(boot.site_time).split(" ")[1],
    items: [
      {
        item_code: code,
        warehouse: boot.physical_leaves[0],
        qty: 2,
        valuation_rate: 4,
      },
    ],
  };
  const managerDraft = await manager.ok("native_api.create_document", {
    doctype: "Stock Reconciliation",
    request_id: crypto.randomUUID(),
    data,
  });
  expect(managerDraft.kind).toBe("Opening");
  expect(managerDraft.editable).toBe(true);
  const managerSaved = await manager.ok("native_api.save_document", {
    doctype: "Stock Reconciliation",
    name: managerDraft.identity.name,
    version: managerDraft.version,
    data,
  });
  await open(
    manager.page,
    `/counts/${encodeURIComponent(managerDraft.identity.name)}`,
  );
  await expect(
    manager.page.getByText(managerDraft.identity.name).first(),
  ).toBeVisible();
  const beforeIdle = await manager.ok("native_api.load_document", {
    doctype: "Stock Reconciliation",
    name: managerDraft.identity.name,
  });
  expect(beforeIdle.version).toBe(managerSaved.version);
  await manager.page.waitForTimeout(2000);
  const afterIdle = await manager.ok("native_api.load_document", {
    doctype: "Stock Reconciliation",
    name: managerDraft.identity.name,
  });
  expect(afterIdle.version, "opening a draft must not autosave it").toBe(
    beforeIdle.version,
  );
  const submitted = await manager.ok("native_api.submit_document", {
    doctype: "Stock Reconciliation",
    name: managerDraft.identity.name,
    version: afterIdle.version,
  });
  expect(submitted.docstatus).toBe(1);
  const operatorOpening = await operator.ok("native_api.load_document", {
    doctype: "Stock Reconciliation",
    name: submitted.name,
  });
  expect(operatorOpening.actions.cancel).toBe(false);
  expect(operatorOpening.actions.amend).toBe(false);
  await open(manager.page, `/counts/${encodeURIComponent(submitted.name)}`);
  await expect(
    manager.page.getByRole("button", { name: "取消记录" }),
  ).toBeVisible();
  await expect(manager.page.getByRole("button", { name: "修订" })).toHaveCount(
    0,
  );
  await open(operator.page, `/counts/${encodeURIComponent(submitted.name)}`);
  await expect(
    operator.page.getByRole("button", { name: "取消记录" }),
  ).toHaveCount(0);
  await expect(operator.page.getByRole("button", { name: "修订" })).toHaveCount(
    0,
  );
  const beforeCancel = await manager.ok("native_api.load_document", {
    doctype: "Stock Reconciliation",
    name: submitted.name,
  });
  const cancelledOpening = await manager.ok("native_api.cancel_document", {
    doctype: "Stock Reconciliation",
    name: submitted.name,
    version: beforeCancel.version,
  });
  expect(cancelledOpening.actions.amend).toBe(true);
  await open(manager.page, `/counts/${encodeURIComponent(submitted.name)}`);
  await expect(
    manager.page.getByRole("button", { name: "修订" }),
  ).toBeVisible();
  await open(operator.page, `/counts/${encodeURIComponent(submitted.name)}`);
  await expect(operator.page.getByRole("button", { name: "修订" })).toHaveCount(
    0,
  );
  await operator.denied("native_api.create_document", {
    doctype: "Stock Reconciliation",
    request_id: crypto.randomUUID(),
    data,
  });
  await operator.close();
  await manager.close();
});

test("manager imports a generated Item workbook over HTTP; Operator is refused", async ({
  browser,
}) => {
  const operator = await login(browser, "operator");
  const manager = await login(browser, "manager");
  const form = new FormData();
  form.set("import_type", "Item");
  form.set(
    "file",
    new File(
      [readFileSync(new URL("./fixtures/item-import.xlsx", import.meta.url))],
      "items.xlsx",
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ),
  );
  const upload = await manager.page.request.post(
    "/api/method/temple_inventory.imports.upload",
    {
      multipart: form,
      headers: {
        "X-Frappe-CSRF-Token": manager.csrf,
        "X-Inventory-Account": manager.user,
      },
    },
  );
  expect(upload.ok(), await upload.text()).toBe(true);
  const preview = (await upload.json()).message;
  expect(["NEW", "UNCHANGED"]).toContain(preview.rows[0].action);
  if (preview.rows[0].action === "NEW") expect(preview.rows[0].target).toBe("");
  const queued = await manager.ok("imports.commit", {
    name: preview.name,
    plan_hash: preview.plan_hash,
    skip_rejected: 0,
  });
  expect(queued.status).toBe("Queued");
  await expect
    .poll(
      async () =>
        (await manager.ok("imports.status", { name: preview.name })).status,
      { timeout: 120000, intervals: [1500] },
    )
    .toBe("Completed");
  const result = await manager.ok("imports.status", { name: preview.name });
  expect(["NEW", "UNCHANGED"]).toContain(result.rows[0].final_action);
  expect(result.rows[0].item_code).toMatch(/^ITM-/);

  const locationTree = await manager.ok("warehouses.tree");
  const location = locationTree.rows.find(
    (row: any) =>
      row.storable && !row.is_group && !row.disabled && !row.protected,
  );
  expect(location, "manager needs an authorized physical leaf").toBeTruthy();
  const workbookScript = [
    "import io, sys, xlsxwriter",
    "out = io.BytesIO()",
    "book = xlsxwriter.Workbook(out, {'in_memory': True})",
    "sheet = book.add_worksheet('期初库存')",
    "headers = ['物品编号*', '位置*', '数量*', '估值单价', '批次编号', '生产日期', '到期日期', '序列号']",
    "[sheet.write_string(0, i, value) for i, value in enumerate(headers)]",
    "[sheet.write_string(1, i, value) for i, value in enumerate([sys.argv[1], sys.argv[2], '1', '4', '', '', '', ''])]",
    "book.close()",
    "sys.stdout.buffer.write(out.getvalue())",
  ].join("\n");
  const openingBytes = execFileSync(
    resolve(process.cwd(), "../../../env/bin/python"),
    ["-c", workbookScript, result.rows[0].item_code, location.label],
  );
  const openingForm = new FormData();
  openingForm.set("import_type", "Opening Stock");
  // The site's date, not the runner's UTC date: in the site's evening, UTC is already tomorrow.
  const siteDate = (await manager.ok("browse.bootstrap")).site_date;
  openingForm.set("posting_date", siteDate);
  openingForm.set("posting_time", "00:00:01");
  openingForm.set(
    "file",
    new File([openingBytes], "opening.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const openingUpload = await manager.page.request.post(
    "/api/method/temple_inventory.imports.upload",
    {
      multipart: openingForm,
      headers: {
        "X-Frappe-CSRF-Token": manager.csrf,
        "X-Inventory-Account": manager.user,
      },
    },
  );
  expect(openingUpload.ok(), await openingUpload.text()).toBe(true);
  const openingPreview = (await openingUpload.json()).message;
  expect(["NEW", "UNCHANGED"]).toContain(openingPreview.rows[0].action);
  const openingQueued = await manager.ok("imports.commit", {
    name: openingPreview.name,
    plan_hash: openingPreview.plan_hash,
    skip_rejected: 0,
  });
  expect(openingQueued.status).toBe("Queued");
  await expect
    .poll(
      async () =>
        (await manager.ok("imports.status", { name: openingPreview.name }))
          .status,
      { timeout: 120000, intervals: [1500] },
    )
    .toBe("Completed");
  const openingResult = await manager.ok("imports.status", {
    name: openingPreview.name,
  });
  expect(openingResult.created_documents).toHaveLength(1);
  expect(["NEW", "UNCHANGED"]).toContain(openingResult.rows[0].final_action);
  const stock = await manager.ok("warehouses.stock_summary", {
    warehouse: location.name,
  });
  expect(stock.rows.some((row: any) => Number(row.stock_qty) > 0)).toBe(true);
  await operator.denied("imports.opening_template");
  await operator.denied("imports.opening_catalog");
  await operator.denied("imports.item_catalog");
  await operator.close();
  await manager.close();
});

test("viewer and operator see ForbiddenState at the Item import URL", async ({
  browser,
}) => {
  for (const key of ["viewer", "operator"] as const) {
    const session = await login(browser, key);
    await open(session.page, "/imports/items");
    await expect(session.page.getByTestId("forbidden-state")).toBeVisible();
    await open(session.page, "/imports/opening");
    await expect(session.page.getByTestId("forbidden-state")).toBeVisible();
    await session.close();
  }
});

const reviewed = [
  ["home", ""],
  ["stock", "/stock"],
  ["expiry", "/stock/expiry"],
  ["damaged", "/stock/damaged"],
  ["warehouses", "/stock/warehouses"],
  ["categories", "/stock/categories"],
  ["units", "/stock/units"],
  ["movements", "/movements"],
  ["movement-records", "/movements?view=records"],
  ["loans", "/loans"],
  ["counts", "/counts"],
  ["drafts", "/drafts"],
  ["activities", "/activities"],
  ["activity-types", "/activities/types"],
  ["reports", "/reports"],
  ["item-import", "/imports/items"],
  ["more", "/more"],
  ["new-receive", "/movements/new/Receive"],
  ["new-count", "/counts/new"],
  ["new-opening", "/counts/opening/new"],
] as const;

const banned: Partial<Record<Key, RegExp>> = {
  viewer:
    /新建|新增|期初库存|添加物品|登记|编辑|删除|修订|取消记录|^选择$|入库$|出库$|调拨$/,
  operator:
    /期初库存|新建盘点|新建分类|新建单位|新建类型|添加区域|删除|修订|取消记录|核对并确认/,
  manager: /添加区域/,
};
for (const key of ["viewer", "operator", "manager"] as const) {
  test(`${key}: no page offers a control the role cannot use`, async ({
    browser,
  }) => {
    test.setTimeout(300000);
    const session = await login(browser, key);
    const { page } = session;
    const entry = await firstName(session, "Stock Entry", 1);
    const paths = [
      ...reviewed
        .map(([, path]) => path)
        .filter(
          (path) => !path.includes("/new") || path === "/counts/opening/new",
        ),
      ...(entry ? [`/movements/${encodeURIComponent(entry)}`] : []),
    ];
    for (const path of paths) {
      await open(page, path);
      const controls = await page
        .locator("main button:visible")
        .allInnerTexts();
      const found = controls
        .map((text) => text.trim())
        .filter((text) => text && text.length < 14 && banned[key]!.test(text));
      expect(found, `${key} ${path || "/"}`).toEqual([]);
    }
    await session.close();
  });
}

for (const key of Object.keys(accounts) as Key[]) {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    test(`${key} ${width}: screenshots`, async ({ browser }) => {
      test.skip(!shots, "Set ROLE_SHOTS_DIR to capture review screenshots");
      test.setTimeout(600000);
      const session = await login(browser, key, width, height);
      const { page } = session;
      const extra: [string, string][] = [];
      const entry = await firstName(session, "Stock Entry", 1);
      if (entry)
        extra.push(["record", `/movements/${encodeURIComponent(entry)}`]);
      const count = await firstName(session, "Stock Reconciliation", 0);
      if (count)
        extra.push(["draft-count", `/counts/${encodeURIComponent(count)}`]);
      for (const [name, path] of [...reviewed, ...extra]) {
        await open(page, path);
        await page.waitForTimeout(600);
        await page.screenshot({
          path: `${shots}/${key}-${width}-${name}.png`,
          fullPage: false,
        });
        const controls = await page
          .locator(
            "main button:visible, main a[role='button']:visible, main a.ui-button:visible",
          )
          .allInnerTexts();
        const overflow = page
          .locator(".browse-header [aria-haspopup='menu']:visible")
          .first();
        if (await overflow.count()) {
          await overflow.click().catch(() => undefined);
          await page.waitForTimeout(250);
          await page.screenshot({
            path: `${shots}/${key}-${width}-${name}-menu.png`,
          });
          controls.push(...(await page.getByRole("menuitem").allInnerTexts()));
          await page.keyboard.press("Escape");
        }
        writeFileSync(
          `${shots}/${key}-${width}-${name}.txt`,
          [
            ...new Set(controls.map((text) => text.trim()).filter(Boolean)),
          ].join("\n"),
        );
      }
      await session.close();
    });
  }
}
