import { sampleWarehouses } from "./fixtures/nativeUi";
import { expect, test, type Request } from "@playwright/test";

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
  let editorClockCalls = 0;
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
            has_batch_no: true,
            has_expiry_date: true,
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
    else if (method === "temple_inventory.native_api.editor_clock") {
      editorClockCalls++;
      message = { timestamp: "2026-10-16 12:00:00" };
    } else if (method === "temple_inventory.native_api.create_document") {
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
    else if (method === "temple_inventory.catalog.receipt_batches")
      message = {
        batches: args.rows.map(
          (row: { local_id: string; batch_id: string }) => ({
            local_id: row.local_id,
            name: row.batch_id,
          }),
        ),
      };
    else if (method === "temple_inventory.catalog.batch_metadata_many")
      message = Object.fromEntries(
        (args.names as string[]).map((name, index) => [
          name,
          {
            name,
            item_code: "ITEM-A",
            expiry_date: index === 0 ? "2027-02-01" : "2027-03-01",
            manufacturing_date: index === 0 ? "2026-01-01" : "2026-02-01",
          },
        ]),
      );
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
  await page.setViewportSize({ width: 430, height: 932 });
  const location = page.getByRole("combobox", { name: "入库位置" }).first();
  await location.focus();
  const locationPopup = page.locator(".search-select-menu").last();
  await expect(locationPopup).toBeVisible();
  await expect(locationPopup).toContainText("演示室甲");
  await page.waitForTimeout(1000);
  const stableSamples = await page.evaluate(async () => {
    const popup = document.querySelector<HTMLElement>(".search-select-menu")!;
    const samples: Array<{ scrollY: number; top: number; left: number }> = [];
    for (let index = 0; index < 6; index++) {
      const rect = popup.getBoundingClientRect();
      samples.push({ scrollY: window.scrollY, top: rect.top, left: rect.left });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
      samples,
      viewport: {
        top: window.visualViewport?.offsetTop ?? 0,
        bottom:
          (window.visualViewport?.offsetTop ?? 0) +
          (window.visualViewport?.height ?? window.innerHeight),
      },
      height: popup.getBoundingClientRect().height,
    };
  });
  expect(
    Math.max(...stableSamples.samples.map((sample) => sample.scrollY)) -
      Math.min(...stableSamples.samples.map((sample) => sample.scrollY)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...stableSamples.samples.map((sample) => sample.top)) -
      Math.min(...stableSamples.samples.map((sample) => sample.top)),
  ).toBeLessThanOrEqual(1);
  expect(stableSamples.samples[0]!.top).toBeGreaterThanOrEqual(
    stableSamples.viewport.top,
  );
  expect(
    stableSamples.samples[0]!.top + stableSamples.height,
  ).toBeLessThanOrEqual(stableSamples.viewport.bottom + 1);
  await page.keyboard.press("Escape");
  await page.locator('[data-field="batch"]').first().fill("BATCH-TEST");
  await page.locator('[data-field="expiry"]').first().fill("2027-02-01");
  await page
    .locator('[data-field="manufacturingDate"]')
    .first()
    .fill("2026-01-01");
  await expect(page.locator('[data-field="expiry"]').first()).toHaveValue(
    "2027-02-01",
  );
  const priorDateStyle = await page.addStyleTag({
    content: `@media (max-width: 1023px) {
      .operation-row-cell input[type="date"] { min-height: 38px; padding-inline: 2px; font-size: 0.72rem; }
    }`,
  });
  await page.screenshot({
    path: test.info().outputPath("phone-inbound-dates-before.png"),
  });
  await priorDateStyle.evaluate((element) => element.remove());
  await page.screenshot({
    path: test.info().outputPath("phone-inbound-dates.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The section's own add action; the phone action bar's copy may still be leaving.
  await page.locator(".operation-add-item-action").first().click();
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
  await page.locator('[data-field="batch"]').nth(1).fill("BATCH-TEST-2");
  await page.locator('[data-field="expiry"]').nth(1).fill("2027-03-01");
  await page
    .locator('[data-field="manufacturingDate"]')
    .nth(1)
    .fill("2026-02-01");
  await page.getByRole("button", { name: "明细操作" }).first().click();
  await page.getByRole("menuitem", { name: "更换物品", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择物品", exact: true });
  await expect(picker).toBeVisible();
  await page.setViewportSize({ width: 430, height: 932 });
  const createItem = picker.getByRole("button", {
    name: "新建物品",
    exact: true,
  });
  await expect(createItem).toBeVisible();
  const resultsScroll = picker.locator(".picker-results-scroll");
  await resultsScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => {
      const box = await createItem.boundingBox();
      return box && box.y >= 0 && box.y + box.height <= 932;
    })
    .toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  const reviewRequests: string[] = [];
  const recordReviewRequests = (request: Request) => {
    if (request.url().includes("/api/method/"))
      reviewRequests.push(request.url());
  };
  page.on("request", recordReviewRequests);
  const reviewStarted = Date.now();
  await page.getByRole("button", { name: "复核并确认", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("确认时的当前时间");
  const clickToPanelMs = Date.now() - reviewStarted;
  expect(clickToPanelMs).toBeLessThan(1000);
  expect(editorClockCalls).toBe(0);
  expect(reviewRequests).toEqual([]);
  console.info(
    `REVIEW_PANEL_TIMING ${JSON.stringify({ clickToPanelMs, requests: reviewRequests.length })}`,
  );
  page.off("request", recordReviewRequests);
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
