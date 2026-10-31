import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";

const shots = "/tmp/codex-runs/browse-selection-shots";
mkdirSync(shots, { recursive: true });

const sessionMethods = [
  "session.info",
  "configuration.status",
  "browse.bootstrap",
];
const loans: Record<
  string,
  { borrower: string; activity: string; qty: number }
> = {
  L1: { borrower: "文化交流与法会筹备组", activity: "ACT-AUTUMN", qty: 2 },
  L2: { borrower: "寺院志工服务组", activity: "ACT-WINTER", qty: 3 },
};

function loanDocument(name: string) {
  const loan = loans[name];
  return {
    name,
    kind: "Loan",
    doctype: "Stock Entry",
    docstatus: 1,
    version: "v1",
    posting_date: "2026-10-20",
    ti_borrower: loan?.borrower ?? "",
    ti_activity: loan?.activity ?? "",
    items: [
      {
        name: `${name}-ROW`,
        item_code: "ITEM-1",
        item_name: "供灯用品",
        s_warehouse: "A02-DIRECT",
        t_warehouse: "LEASED-A",
        stock_uom: "Nos",
        uom: "Nos",
        conversion_factor: 1,
        allocations: [{ batch_no: "", outstanding_qty: loan?.qty ?? 0 }],
      },
    ],
  };
}

test("mixed-borrower Return editor and confirmation screenshots", async ({
  page,
}) => {
  await nativeUiSession(page, 100, {
    leased_leaves: ["LEASED-A"],
    operations: { Return: true, Loan: true },
  });
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    if (sessionMethods.includes(method)) return route.fallback();
    const args = route.request().postDataJSON() || {};
    let message: unknown = [];
    if (method === "native_api.loan_detail")
      message = loanDocument(String(args.name));
    else if (method === "catalog.operation_items")
      message = {
        items: [
          {
            item_code: "ITEM-1",
            item_name: "供灯用品",
            stock_uom: "Nos",
            item_group: "日常用品",
            version: "item-v1",
            can_edit: false,
            description: "",
            has_batch_no: false,
            has_expiry_date: false,
            barcodes: [],
            uoms: [{ uom: "Nos", conversion_factor: 1 }],
            stock: [{ warehouse: "A02-DIRECT", available: 9 }],
          },
        ],
        errors: [],
      };
    else if (method === "native_api.outstanding_loan_groups")
      message = {
        rows: [
          {
            borrower: loans.L1!.borrower,
            loan_count: 1,
            item_count: 1,
            latest_date: "2026-10-20",
          },
          {
            borrower: loans.L2!.borrower,
            loan_count: 1,
            item_count: 1,
            latest_date: "2026-10-21",
          },
        ],
        next: null,
      };
    else if (method === "native_api.outstanding_loans")
      message = { rows: [], next: null };
    else if (method === "native_api.editor_clock")
      message = { timestamp: "2026-10-31 10:00:00" };
    else if (method === "native_files.attachments") message = [];
    else if (method === "catalog.batch_metadata_many") message = {};
    await route.fulfill({ json: { message } });
  });

  const url = `/inventory/movements/new/Return?loans=${encodeURIComponent(JSON.stringify(["L1", "L2"]))}`;
  for (const [width, height, label] of [
    [1440, 900, "desktop"],
    [390, 844, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    const chips = page.locator(".selected-loan-chips button");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText("借用方 文化交流与法会筹备组");
    await expect(chips.nth(1)).toContainText("借用方 寺院志工服务组");
    await expect(page.locator(".operation-section")).toContainText("ITEM-1");
    await page.screenshot({
      path: `${shots}/return-mixed-editor-${label}.png`,
    });
    await page.getByRole("button", { name: "复核并确认" }).click();
    const dialog = page.locator(".ui-overlay");
    await expect(dialog).toContainText(
      "原借出 L1 · 借用方 文化交流与法会筹备组",
    );
    await expect(dialog).toContainText("原借出 L2 · 借用方 寺院志工服务组");
    await page.screenshot({
      path: `${shots}/return-mixed-confirm-${label}.png`,
    });
    await dialog.getByRole("button", { name: "返回检查" }).click();
  }
});
