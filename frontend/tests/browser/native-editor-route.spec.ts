import { sampleWarehouses } from "./fixtures/nativeUi";
import { expect, test } from "@playwright/test";

// Production routing/transport exercise with controlled native responses.
// Real native interoperability is validated separately on development.localhost.
test("save, reload and amendment keep the current native identity in the URL", async ({
  page,
}) => {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let document: Record<string, unknown> | undefined;
  let creates = 0,
    amendments = 0;
  const loadedNames: string[] = [];
  const permissions = {
    write: true,
    submit: true,
    delete: true,
    cancel: true,
    amend: true,
  };
  await page.route("**/api/method/**", async (route) => {
    const method = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const args = route.request().postDataJSON() || {};
    let message: unknown;
    if (method === "temple_inventory.session.info")
      message = {
        user: "manager",
        csrf_token: "editor-route",
        ui_preferences: { theme: "jade", density: "balanced", textScale: 100 },
      };
    else if (method === "temple_inventory.configuration.status")
      message = { setup_required: false, blockers: [], warnings: [] };
    else if (method === "temple_inventory.browse.bootstrap")
      message = {
        user: "manager",
        site: "editor-route-test",
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
        uoms: [{ name: "Nos", must_be_whole_number: true }],
        activity_types: [],
        capabilities: {
          "Stock Entry": { read: true, create: true, ...permissions },
        },
        operations: { Receive: true, Issue: true },
      };
    else if (method === "temple_inventory.catalog.operation_items")
      message = {
        items: [
          {
            item_code: args.item_codes?.[0],
            item_name: "测试物品",
            item_group: "用品",
            stock_uom: "Nos",
            description: "",
            version: "item-v1",
            has_batch_no: false,
            has_expiry_date: false,
            can_edit: false,
            barcodes: [],
            uoms: [{ uom: "Nos", conversion_factor: 1 }],
            stock: [
              {
                warehouse: "A02-DIRECT",
                warehouse_label: "演示室甲",
                available: 7,
                loaned: 0,
                damaged: 0,
              },
            ],
            attachments: [],
          },
        ],
        errors: [],
      };
    else if (method === "temple_inventory.catalog.picker_rows")
      message = {
        results: [
          {
            item_code: "ITEM-A",
            item_name: "测试物品",
            item_group: "用品",
            stock_uom: "Nos",
            description: "",
            version: "item-v1",
            has_batch_no: false,
            has_expiry_date: false,
            can_edit: false,
            barcodes: [],
            uoms: [{ uom: "Nos", conversion_factor: 1 }],
            stock: [
              {
                warehouse: "A02-DIRECT",
                warehouse_label: "演示室甲",
                available: 7,
                loaned: 0,
                damaged: 0,
              },
            ],
            warehouse: "A02-DIRECT",
            warehouse_label: "演示室甲",
            picker_quantity: 7,
          },
        ],
        matched_count: 1,
        next_start: null,
      };
    else if (
      method === "temple_inventory.table_preferences.get_column_preferences"
    )
      message = {};
    else if (method === "temple_inventory.catalog.item_lifecycle")
      message = {
        disabled: false,
        tracking_changeable: true,
        tracking_change_reason: "",
        can_delete: true,
      };
    else if (method === "temple_inventory.native_files.attachments")
      message = [];
    else if (method === "temple_inventory.native_api.editor_clock")
      message = { timestamp: "2026-10-16 12:00:00" };
    else if (method === "temple_inventory.native_api.create_document") {
      creates++;
      document = {
        ...args.data,
        doctype: "Stock Entry",
        name: "STE-NEW",
        version: "2026-10-16 12:00:01",
        docstatus: 0,
        kind: "Receive",
        purpose: "Material Receipt",
        editable: true,
        permissions,
        items: args.data.items.map((row, index) => ({
          ...row,
          name: `ROW-${index}`,
          transfer_qty: Number(row.qty) * Number(row.conversion_factor),
          stock_uom: "Nos",
        })),
      };
      message = document;
    } else if (method === "temple_inventory.native_api.load_document") {
      loadedNames.push(String(args.name));
      message = document;
    } else if (method === "temple_inventory.native_api.save_document") {
      document = { ...document, ...args.data, version: "2026-10-16 12:00:02" };
      message = document;
    } else if (method === "temple_inventory.native_api.submit_document") {
      document = {
        ...document,
        docstatus: 1,
        editable: false,
        version: "2026-10-16 12:00:03",
      };
      message = document;
    } else if (method === "temple_inventory.native_api.cancel_document") {
      document = {
        ...document,
        docstatus: 2,
        editable: false,
        version: "2026-10-16 12:00:04",
      };
      message = document;
    } else if (method === "temple_inventory.native_api.amend_document") {
      amendments++;
      document = {
        ...document,
        name: "STE-AMENDED",
        amended_from: "STE-NEW",
        docstatus: 0,
        editable: true,
        version: "2026-10-16 12:00:05",
      };
      message = document;
    } else if (method === "temple_inventory.notifications.inbox")
      message = { items: [], unread_count: 0, has_running_exports: false };
    else if (method === "temple_inventory.preferences.creation_locations")
      message = { Receive: "A02-DIRECT" };
    else if (method === "temple_inventory.preferences.save_creation_location")
      message = {};
    else {
      unexpected.push(method);
      await route.fulfill({
        status: 500,
        json: { message: "测试未配置此请求" },
      });
      return;
    }
    await route.fulfill({ json: { message } });
  });
  await page.goto(
    `/inventory/movements/new/Receive?warehouse=A02-DIRECT&items=${encodeURIComponent(JSON.stringify(["ITEM-A"]))}`,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "添加物品", exact: true }).click();
  const addPicker = page.getByRole("dialog", { name: "选择物品", exact: true });
  await expect(addPicker).toBeVisible();
  await expect(
    addPicker.locator(".picker-data-table tbody tr"),
  ).not.toHaveCount(0);
  await addPicker
    .locator(".picker-data-table tbody input[type=checkbox]")
    .first()
    .check();
  await addPicker.getByRole("button", { name: /添加所选/ }).click();
  await page.getByRole("button", { name: "明细操作" }).first().click();
  await page.getByRole("menuitem", { name: "更换物品", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择物品", exact: true });
  await expect(picker).toBeVisible();
  const chooseButton = picker.getByRole("button", {
    name: "选择",
    exact: true,
  });
  await expect(chooseButton).toBeVisible();
  const buttonBox = await chooseButton.boundingBox();
  const actionCell = chooseButton.locator("xpath=ancestor::td[1]");
  const cellBox = await actionCell.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(cellBox).not.toBeNull();
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(
    cellBox!.x + cellBox!.width + 1,
  );
  await page.screenshot({
    path: test.info().outputPath("item-picker-replace.png"),
  });
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/movements\/STE-NEW(?:\?|$)/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "复核并确认", exact: true }),
  ).toBeVisible();
  expect(creates).toBe(1);
  await page.getByRole("button", { name: "复核并确认", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认提交", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "取消记录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消记录", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.getByRole("button", { name: "创建修订草稿", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/movements\/STE-AMENDED(?:\?|$)/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeVisible();
  expect(loadedNames).toContain("STE-NEW");
  expect(creates).toBe(1);
  expect(amendments).toBe(1);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      `/inventory/movements/new/Issue?warehouse=A02-DIRECT&items=${encodeURIComponent(JSON.stringify(["ITEM-A"]))}`,
    );
    await expect(page.locator(".operation-row-existing")).toContainText(
      "现有 7",
    );
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          `outbound-existing-${width < 1024 ? "phone" : "desktop"}.png`,
        ),
      fullPage: true,
    });
  }
});
