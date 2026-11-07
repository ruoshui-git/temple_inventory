import type { Locator, Page } from "@playwright/test";
import type { CapabilitySet } from "../../src/services/contracts";
import { existsSync } from "node:fs";

export const auditCjkFont = [
  process.env.TEMPLE_UI_CJK_FONT,
  process.env.NATIVE_UI_REVIEW_FONT,
  "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
].find((candidate) => Boolean(candidate && existsSync(candidate)));

export function auditCjkFontType(font = auditCjkFont) {
  return font?.endsWith(".ttc") ? "font/collection" : "font/otf";
}

export function requiredAuditCjkFont() {
  if (!auditCjkFont) throw new Error("No readable CJK audit font is available");
  return auditCjkFont;
}

export const fullNativeCapabilities: CapabilitySet = {
  stock_entry: {
    read: true,
    create: true,
    write: true,
    submit: true,
    cancel: true,
    amend: true,
    delete: true,
  },
  stock_reconciliation: {
    read: true,
    create: true,
    write: true,
    submit: true,
    cancel: true,
    amend: true,
    delete: true,
  },
  item: { create: true, write: true, delete: true },
  batch: { create: true, write: true },
  activity: { create: true, write: true, delete: true },
  activity_type: { create: true, write: true, delete: true },
  item_group: { create: true, write: true, delete: true },
  uom: { create: true, write: true, delete: true },
  warehouse: { create: true, write: true, delete: true },
  settings: { write: true },
  imports: { create: true },
};

function place(
  name: string,
  label: string,
  local_label: string,
  path: string,
  kind: "area" | "room" | "shelf" | "system",
  parent: string,
  lft: number,
  rgt: number,
  is_group: boolean,
  direct = false,
  owner = "",
) {
  return {
    name,
    label,
    local_label,
    short_label: "",
    full_label: local_label,
    path,
    search_text: `${path} ${local_label} ${name}`,
    kind,
    owner,
    direct,
    storable:
      direct || !is_group || name.endsWith("ROOM-A") || name.endsWith("ROOM-B"),
    missing_direct: false,
    parent,
    is_group,
    disabled: false,
    lft,
    rgt,
    version: "test-v1",
    protected: kind === "system",
    can_edit: kind !== "system" && !direct,
  };
}
export const sampleWarehouses = [
  place("PHYSICAL", "实体库房", "实体库房", "", "system", "", 1, 30, true),
  place("T2", "T2", "T2", "T2", "area", "PHYSICAL", 2, 9, true),
  place("ROOM-A", "A02", "A02", "T2 / A02", "room", "T2", 3, 6, true),
  place(
    "A02-DIRECT",
    "A02",
    "A02",
    "T2 / A02",
    "room",
    "ROOM-A",
    4,
    5,
    false,
    true,
    "ROOM-A",
  ),
  place(
    "DEMO-AREA",
    "演示区",
    "演示区",
    "演示区",
    "area",
    "PHYSICAL",
    10,
    29,
    true,
  ),
  place(
    "DEMO-ROOM-A",
    "演示室甲",
    "演示室甲",
    "演示区 / 演示室甲",
    "room",
    "DEMO-AREA",
    11,
    20,
    true,
  ),
  place(
    "SHELF-1",
    "演示室甲 / 演示架1",
    "演示架1",
    "演示区 / 演示室甲 / 演示架1",
    "shelf",
    "DEMO-ROOM-A",
    12,
    13,
    false,
  ),
  place(
    "DEMO-A-DIRECT",
    "演示室甲",
    "演示室甲",
    "演示区 / 演示室甲",
    "room",
    "DEMO-ROOM-A",
    14,
    15,
    false,
    true,
    "DEMO-ROOM-A",
  ),
  place(
    "DEMO-ROOM-B",
    "演示室乙",
    "演示室乙",
    "演示区 / 演示室乙",
    "room",
    "DEMO-AREA",
    21,
    28,
    true,
  ),
  place(
    "ROOM-B-DIRECT",
    "演示室乙",
    "演示室乙",
    "演示区 / 演示室乙",
    "room",
    "DEMO-ROOM-B",
    22,
    23,
    false,
    true,
    "DEMO-ROOM-B",
  ),
];

/** Controlled HTTP contracts for production-UI tests, never native DB acceptance. */
export async function nativeUiSession(
  page: Page,
  textScale = 100,
  bootstrap: Record<string, unknown> = {},
  role: "Administrator" | "Viewer" | "Operator" | "Manager" = "Administrator",
) {
  const capabilities = Object.fromEntries(
    [
      [
        "stock_entry",
        ["read", "create", "write", "submit", "cancel", "amend", "delete"],
      ],
      [
        "stock_reconciliation",
        ["read", "create", "write", "submit", "cancel", "amend", "delete"],
      ],
      ["item", ["create", "write", "delete"]],
      ["batch", ["create", "write"]],
      ["activity", ["create", "write", "delete"]],
      ["activity_type", ["create", "write", "delete"]],
      ["item_group", ["create", "write", "delete"]],
      ["uom", ["create", "write", "delete"]],
      ["warehouse", ["create", "write", "delete"]],
      ["settings", ["write"]],
      ["imports", ["create"]],
    ].map(([domain, keys]) => [
      domain,
      Object.fromEntries((keys as string[]).map((key) => [key, true])),
    ]),
  );
  const matrix: Record<string, string[]> = {
    Viewer: [],
    Operator: [
      "stock_entry.create",
      "stock_entry.write",
      "stock_entry.submit",
      "item.create",
      "item.write",
      "batch.create",
      "batch.write",
      "activity.create",
      "activity.write",
    ],
    Manager: [
      "stock_entry.create",
      "stock_entry.write",
      "stock_entry.submit",
      "stock_entry.cancel",
      "stock_entry.amend",
      "stock_entry.delete",
      "stock_reconciliation.create",
      "stock_reconciliation.write",
      "stock_reconciliation.submit",
      "stock_reconciliation.cancel",
      "stock_reconciliation.amend",
      "stock_reconciliation.delete",
      "item.create",
      "item.write",
      "batch.create",
      "batch.write",
      "activity.create",
      "activity.write",
      "activity_type.create",
      "activity_type.write",
      "activity_type.delete",
      "item_group.create",
      "item_group.write",
      "item_group.delete",
      "uom.create",
      "uom.write",
      "uom.delete",
      "imports.create",
    ],
  };
  if (role !== "Administrator") {
    for (const domain of Object.keys(capabilities))
      for (const action of Object.keys((capabilities as any)[domain]))
        (capabilities as any)[domain][action] = false;
    for (const item of matrix[role]) {
      const [domain, action] = item.split(".");
      (capabilities as any)[domain][action] = true;
    }
    for (const domain of ["stock_entry", "stock_reconciliation"])
      (capabilities as any)[domain].read = true;
  }
  const replies = {
    "session.info": {
      user: "manager",
      csrf_token: "native-ui-test",
      role_label: {
        Administrator: "管理员",
        Viewer: "只读",
        Operator: "录入员",
        Manager: "负责人",
      }[role],
      capabilities,
      ui_preferences: {
        theme: "jade",
        density: "balanced",
        textScale,
        default_periods: {
          dashboard: "this_month",
          movements: "this_month",
          loans: "this_month",
          counts: "this_month",
        },
      },
    },
    "configuration.status": {
      setup_required: false,
      blockers: [],
      warnings: [],
    },
    "warehouses.tree": {
      rows: (
        (bootstrap.warehouses as typeof sampleWarehouses | undefined) ||
        sampleWarehouses
      ).map((row) => ({
        ...row,
        can_edit: role === "Administrator" && row.can_edit,
      })),
      physical_root: "PHYSICAL",
      can_create: role === "Administrator",
      company: "TEST",
    },
    "catalog.item_lifecycle": {
      disabled: false,
      can_edit: role !== "Viewer",
      can_delete: role === "Administrator",
      tracking_changeable: true,
      tracking_change_reason: "",
    },
    "browse.bootstrap": {
      user: "manager",
      site: "native-ui-test",
      site_date: "2026-10-16",
      site_time: "2026-10-16 12:00:00",
      settings: { company: "TEST" },
      physical_leaves: [
        "A02-DIRECT",
        "SHELF-1",
        "DEMO-A-DIRECT",
        "ROOM-B-DIRECT",
      ],
      leased_leaves: [],
      damaged_leaves: [],
      categories: [],
      warehouses: sampleWarehouses,
      uoms: [
        { name: "Nos", must_be_whole_number: true },
        { name: "箱", must_be_whole_number: true },
      ],
      activity_types: [],
      capabilities,
      operations: {
        Receive: true,
        Issue: true,
        Transfer: true,
        Loan: true,
        Return: true,
        Repair: true,
        Disposal: true,
        Reconcile: true,
      },
      ...bootstrap,
    },
  };
  for (const [method, message] of Object.entries(replies))
    await page.route("**/api/method/temple_inventory." + method, (route) =>
      route.fulfill({ json: { message } }),
    );
  await page.route(
    "**/api/method/temple_inventory.native_api.load_document",
    (route) => {
      const payload = route.request().postDataJSON() as {
        args?: { doctype?: string; name?: string };
        doctype?: string;
        name?: string;
      };
      const args = payload.args || payload;
      const submitted = args.name === "TEST-SUBMITTED";
      const reconciliation = args.doctype === "Stock Reconciliation";
      route.fulfill({
        json: {
          message: {
            doctype: args.doctype,
            name: args.name,
            version: "test-v1",
            modified: "2026-10-16 12:00:00",
            docstatus: submitted ? 1 : 0,
            editable: false,
            purpose: reconciliation ? "Stock Reconciliation" : undefined,
            ti_movement_kind: reconciliation ? undefined : "Receive",
            posting_date: "2026-10-16",
            posting_time: "12:00:00",
            items: [],
            ti_count_review: [],
            actions: submitted && role === "Manager" ? { cancel: true } : {},
          },
        },
      });
    },
  );
}

/**
 * Phone record lists open as rows. Phone browse pages switch to the table from the result-summary
 * toggle (表格视图); desktop has no toggle because its layout is always the table. Clicks auto-wait
 * for the control to render.
 */
export async function showPhoneTable(page: Page) {
  await page
    .locator(".browse-summary-controls")
    .getByRole("button", { name: "表格视图", exact: true })
    .click();
}

/**
 * Sticky table headers cover rows that scroll beneath them. Playwright does not scroll a target that
 * is visible but covered, so centre it first and click where a reader would.
 */
export async function centerForPointer(target: Locator) {
  await target.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
}
