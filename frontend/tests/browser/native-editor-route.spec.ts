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
        physical_leaves: ["ROOM-A"],
        leased_leaves: [],
        damaged_leaves: [],
        categories: [],
        warehouses: [
          {
            name: "ROOM-A",
            local_label: "库房甲",
            breadcrumb: "库房甲",
            is_group: false,
          },
        ],
        uoms: [{ name: "Nos", must_be_whole_number: true }],
        activity_types: [],
        capabilities: {
          "Stock Entry": { read: true, create: true, ...permissions },
        },
        operations: { Receive: true },
      };
    else if (method === "temple_inventory.catalog.operation_item")
      message = {
        item_code: args.item_code,
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
        stock: [],
        attachments: [],
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
    } else if (method === "temple_inventory.native_api.load_document")
      message = document;
    else if (method === "temple_inventory.native_api.save_document") {
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
    } else {
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
    `/inventory/movements/movements/new/Receive?warehouse=ROOM-A&items=${encodeURIComponent(JSON.stringify(["ITEM-A"]))}`,
  );
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(
    /\/inventory\/documents\/Stock%20Entry\/STE-NEW$/,
  );
  await expect(
    page.getByText("STE-NEW", { exact: true }).first(),
  ).toBeVisible();
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
    page.getByRole("button", { name: "取消原生记录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消原生记录", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.getByRole("button", { name: "创建修订草稿", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/inventory\/documents\/Stock%20Entry\/STE-AMENDED$/,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeVisible();
  expect(creates).toBe(1);
  expect(amendments).toBe(1);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
