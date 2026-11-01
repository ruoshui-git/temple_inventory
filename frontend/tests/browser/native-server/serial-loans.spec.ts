import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { nativeUiSession } from "../fixtures/nativeUi";

const shots = "/tmp/codex-runs/serial-loans-shots";
mkdirSync(shots, { recursive: true });

test("serial loan detail and prefills the Return editor at desktop and phone sizes", async ({
  page,
}) => {
  const login = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(login.ok()).toBe(true);
  await nativeUiSession(page, 100, {
    leased_leaves: ["LEASED-A"],
    damaged_leaves: ["DAMAGED-A"],
    operations: { Return: true, Loss: true },
  });
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    if (
      ["session.info", "configuration.status", "browse.bootstrap"].includes(
        method,
      )
    )
      return route.fallback();
    const args = route.request().postDataJSON() || {};
    let message: unknown = [];
    if (method === "native_api.loan_detail") {
      message = {
        name: args.name,
        doctype: "Stock Entry",
        kind: "Loan",
        docstatus: 1,
        version: "loan-v1",
        posting_date: "2026-10-28",
        posting_time: "10:30:00",
        ti_borrower: "法会用品借用组",
        ti_activity: "ACT-AUTUMN",
        activity_title: "秋季法会",
        balance_at: "2026-11-01 10:45:00",
        items: [
          {
            name: "LOAN-LINE-1",
            item_code: "ITEM-SERIAL-LAMP",
            item_name: "礼佛照明设备",
            ti_display_item_name: "礼佛照明设备",
            ti_display_tracks_serial: true,
            stock_uom: "Nos",
            uom: "Nos",
            qty: 5,
            conversion_factor: 1,
            transfer_qty: 5,
            s_warehouse: "A02-DIRECT",
            t_warehouse: "LEASED-A",
            serials: [
              "LAMP-SN-001",
              "LAMP-SN-002",
              "LAMP-SN-003",
              "LAMP-SN-004",
              "LAMP-SN-005",
            ],
            lent_serials: [
              "LAMP-SN-001",
              "LAMP-SN-002",
              "LAMP-SN-003",
              "LAMP-SN-004",
              "LAMP-SN-005",
            ],
            outstanding_serials: [
              "LAMP-SN-001",
              "LAMP-SN-002",
              "LAMP-SN-003",
              "LAMP-SN-004",
              "LAMP-SN-005",
            ],
            settled_serials: { Returned: [], Damaged: [], Lost: [] },
            outstanding_qty: 5,
            outcomes: { Returned: 0, Damaged: 0, Lost: 0 },
            allocations: [
              {
                batch_no: "",
                borrowed_qty: 5,
                outstanding_qty: 5,
                outcomes: { Returned: 0, Damaged: 0, Lost: 0 },
              },
            ],
          },
        ],
      };
    } else if (method === "browse.movement_history") {
      message = {
        rows: [],
        matched_count: 0,
        next_start: null,
        history_complete: true,
      };
    } else if (method === "catalog.operation_items") {
      message = {
        items: [
          {
            item_code: "ITEM-SERIAL-LAMP",
            item_name: "礼佛照明设备",
            stock_uom: "Nos",
            item_group: "仪式用品",
            version: "item-v1",
            can_edit: false,
            description: "",
            has_serial_no: true,
            has_batch_no: false,
            has_expiry_date: false,
            barcodes: [],
            uoms: [{ uom: "Nos", conversion_factor: 1 }],
            stock: [
              { warehouse: "A02-DIRECT", available: 0, loaned: 5, damaged: 0 },
            ],
          },
        ],
        errors: [],
      };
    } else if (method === "native_api.editor_clock") {
      message = { timestamp: "2026-11-01 10:45:00" };
    } else if (method === "native_files.attachments") {
      message = [];
    } else if (method === "catalog.batch_metadata_many") {
      message = {};
    }
    await route.fulfill({ json: { message } });
  });

  for (const [width, height, label] of [
    [1440, 900, "desktop"],
    [390, 844, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/inventory/loans/LOAN-SERIAL");
    await expect(page.getByRole("heading", { name: "借用详情" })).toBeVisible();
    await page.getByText("序列号", { exact: true }).click();
    await expect(
      page.getByText("LAMP-SN-001 · LAMP-SN-002 · LAMP-SN-003 +2"),
    ).toBeVisible();
    await page.screenshot({
      path: `${shots}/loan-detail-${label}.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "登记归还" }).click();
    await expect(page.locator(".operation-serial-chip")).toHaveCount(5);
    await expect(page.locator(".operation-serial-chip").first()).toContainText(
      "LAMP-SN-001",
    );
    await page
      .locator(".operation-row-serial")
      .first()
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${shots}/return-prefilled-${label}.png`,
    });
  }
});
