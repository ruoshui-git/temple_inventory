import { expect, test, type APIRequestContext } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

// Real Frappe HTTP and built assets: no native API responses are intercepted.
let csrf = "";
async function call(request: APIRequestContext, method: string, data = {}) {
  const response = await request.post(
    `/api/method/temple_inventory.${method}`,
    {
      data,
      headers: {
        "X-Frappe-CSRF-Token": csrf,
        "X-Inventory-Account": "Administrator",
      },
    },
  );
  expect(response.ok(), `${method}: HTTP ${response.status()}`).toBe(true);
  const body = await response.json();
  expect(body.exc_type, `${method} native error`).toBeUndefined();
  return body.message;
}
test.beforeEach(async ({ page }) => {
  test.skip(
    !process.env.NATIVE_ADMIN_PASSWORD,
    "Requires the authorized local Administrator credential",
  );
  const response = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(response.ok()).toBe(true);
  const session = await page.request.get(
    "/api/method/temple_inventory.session.info",
  );
  expect(session.ok()).toBe(true);
  const data = (await session.json()).message;
  expect(data.user).toBe("Administrator");
  csrf = data.csrf_token;
  // Start tracing after authentication so credentials never enter artifacts.
  await page
    .context()
    .tracing.start({ screenshots: true, snapshots: true, sources: true });
});
test.afterEach(async ({ page }, testInfo) => {
  await page
    .context()
    .tracing.stop(
      testInfo.status !== testInfo.expectedStatus
        ? { path: testInfo.outputPath("trace.zip") }
        : {},
    );
});

async function removeNative(
  request: APIRequestContext,
  doctype: string,
  name: string,
) {
  const response = await request.post("/api/method/frappe.client.delete", {
    timeout: 15000,
    data: { doctype, name },
    headers: { "X-Frappe-CSRF-Token": csrf },
  });
  expect(response.ok(), `cleanup ${doctype}: HTTP ${response.status()}`).toBe(
    true,
  );
}

test("real Item editor creates, uploads privately, edits and removes its own image", async ({
  page,
  browser,
}) => {
  const code = `TI-ACCEPT-${crypto.randomUUID().slice(0, 12)}`;
  let created = false;
  try {
    const bootstrap = await call(page.request, "browse.bootstrap");
    const category = bootstrap.categories.find((row) => !row.is_group);
    expect(category).toBeTruthy();
    await page.goto("/inventory/items/new");
    await page.getByLabel("物品编号", { exact: true }).fill(code);
    await page
      .getByLabel("物品名称", { exact: true })
      .fill("原生浏览器验收物品");
    await page
      .getByRole("combobox", { name: "分类", exact: true })
      .fill(category.name);
    await page
      .getByRole("listbox", { name: "分类", exact: true })
      .getByRole("option")
      .first()
      .click();
    await page
      .getByLabel("条码（每行一个，可选）", { exact: true })
      .fill(`${code}-A\n${code}-B`);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("temple_inventory.catalog.save_item") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存物品", exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.ok()).toBe(true);
    created = (await savedResponse.json()).message.item_code === code;
    expect(created).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/item/${code}$`));
    await page.goto(`/inventory/item/${code}/edit`);
    await page.getByLabel("添加图片", { exact: true }).setInputFiles({
      name: `${code}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      page.getByRole("button", { name: "设为主图", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "设为主图", exact: true }).click();
    await expect(page.getByText("主图", { exact: true })).toBeVisible();
    const item = await call(page.request, "catalog.operation_item", {
      item_code: code,
    });
    expect(item.attachments).toHaveLength(1);
    expect(item.barcodes.map((row) => row.barcode)).toEqual([
      `${code}-A`,
      `${code}-B`,
    ]);
    expect(item.image).toMatch(/^\/private\/files\//);
    expect((await page.request.get(item.image)).ok()).toBe(true);
    const guest = await browser.newContext();
    try {
      const denied = await guest.request.get(
        new URL(
          item.image,
          process.env.NATIVE_BASE_URL || "http://127.0.0.1:8101",
        ).href,
        { maxRedirects: 0 },
      );
      expect(denied.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await guest.close();
    }
    await page
      .getByLabel("物品名称", { exact: true })
      .fill("原生浏览器验收物品已编辑");
    await page.getByRole("button", { name: "保存物品", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/item/${code}$`));
    await page.reload();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "原生浏览器验收物品已编辑",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/inventory/item/${code}/edit`);
    await page.getByRole("button", { name: "移除", exact: true }).click();
    await expect(page.getByText("暂无附件", { exact: true })).toBeVisible();
    expect(
      (await call(page.request, "catalog.operation_item", { item_code: code }))
        .attachments,
    ).toEqual([]);
  } finally {
    if (created) {
      test.setTimeout(test.info().timeout + 30000);
      const item = await call(page.request, "catalog.operation_item", {
        item_code: code,
      });
      for (const file of item.attachments)
        await call(page.request, "native_files.remove_attachment", {
          doctype: "Item",
          name: code,
          file_name: file.name,
        });
      await removeNative(page.request, "Item", code);
    }
  }
});

test("real Activity editor retains immutable identity across rename, archive and deletion", async ({
  page,
}) => {
  const title = `浏览器活动验收-${crypto.randomUUID().slice(0, 8)}`;
  let name = "";
  try {
    await page.goto("/inventory/activities/new");
    await page.getByLabel("名称 *", { exact: true }).fill(title);
    await page.getByRole("combobox", { name: "类型 *", exact: true }).click();
    await page
      .getByRole("listbox", { name: "类型 *", exact: true })
      .getByRole("option")
      .first()
      .click();
    await page
      .getByLabel("详细备注", { exact: true })
      .fill("第一行\n\n<b>保留为纯文本</b>");
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("temple_inventory.activities.save_activity"),
    );
    await page.getByRole("button", { name: "保存活动", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    name = (await response.json()).message.name;
    expect(name).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/activities/${name}$`));
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("名称 *", { exact: true }).fill(`${title}-修改`);
    await page.getByRole("button", { name: "保存活动", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `${title}-修改`,
    );
    await expect(page).toHaveURL(new RegExp(`/activities/${name}$`));
    await page.getByText("详细备注", { exact: true }).click();
    await expect(page.locator(".activity-notes")).toHaveText(
      "第一行\n\n<b>保留为纯文本</b>",
    );
    await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("button", { name: "归档活动", exact: true }).click();
    await expect(
      page.getByText("已归档", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    expect(
      (await call(page.request, "activities.load_activity", { name })).status,
    ).toBe("Archived");
  } finally {
    if (name) {
      test.setTimeout(test.info().timeout + 30000);
      const activity = await call(page.request, "activities.load_activity", {
        name,
      });
      await call(page.request, "activities.delete_activity", {
        name,
        version: activity.modified,
      });
    }
  }
});

test("real Warehouse editor creates an empty group and edits native metadata", async ({
  page,
}) => {
  const label = `浏览器仓库验收-${crypto.randomUUID().slice(0, 8)}`;
  let name = "";
  try {
    const bootstrap = await call(page.request, "browse.bootstrap");
    await page.goto("/inventory/warehouses");
    await page
      .getByRole("button", { name: "新建仓库 / 位置", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称", { exact: true }).fill(label);
    await dialog
      .getByRole("combobox", { name: "上级节点", exact: true })
      .fill(bootstrap.settings.physical_root_warehouse);
    await dialog
      .getByRole("listbox", { name: "上级节点", exact: true })
      .getByRole("option")
      .first()
      .click();
    const group = dialog.getByRole("checkbox", {
      name: "分组节点（组织下级，不直接存放库存）",
      exact: true,
    });
    await expect(group).not.toBeChecked();
    await group.check();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("temple_inventory.warehouses.save_warehouse"),
    );
    await dialog
      .getByRole("button", { name: "保存仓库资料", exact: true })
      .click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    name = (await response.json()).message.name;
    expect(name).toBeTruthy();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "搜索仓库", exact: true })
      .fill(label);
    await page
      .getByRole("group", { name: label, exact: true })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await dialog.getByLabel("名称", { exact: true }).fill(`${label}-修改`);
    await dialog
      .getByRole("combobox", { name: "物理类型", exact: true })
      .selectOption("Location");
    await dialog
      .getByRole("button", { name: "保存仓库资料", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    const tree = await call(page.request, "warehouses.tree");
    expect(tree.rows.find((row) => row.name === name)).toMatchObject({
      label: `${label}-修改`,
      type: "Location",
      is_group: true,
    });
  } finally {
    if (name) {
      test.setTimeout(test.info().timeout + 30000);
      await removeNative(page.request, "Warehouse", name);
    }
  }
});

test("real matching count finishes without creating an adjustment document", async ({
  page,
}) => {
  const query = { dataset: "counts" };
  const before = await call(page.request, "projections.report_page", { query });
  const warehouse = "A02 / 无货位 - O";
  await page.goto(
    `/inventory/reconcile/new?warehouse=${encodeURIComponent(warehouse)}&items=${encodeURIComponent(JSON.stringify(["TI-SAMPLE-N-WORKFLOW"]))}`,
  );
  const row = page.locator("[data-count-key]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("账面 70");
  const matching = page.waitForResponse((response) =>
    response.url().endsWith("temple_inventory.counts.save_count"),
  );
  await row.locator('input[type="number"]').fill("70");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await (await matching).json()).message).toMatchObject({
    no_adjustment: true,
  });
  await expect(
    page.getByRole("heading", {
      name: "已核对的数量一致，无需库存调整",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "结束本次核对", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "本次核对已结束。" }),
  ).toBeVisible();
  const after = await call(page.request, "projections.report_page", { query });
  expect(after.matched_count).toBe(before.matched_count);
  expect(after.rows.map((value) => value.document)).toEqual(
    before.rows.map((value) => value.document),
  );
});

test("native seed, clean schema, private originals and the real built app", async ({
  page,
  browser,
}) => {
  const bootstrap = await call(page.request, "browse.bootstrap");
  expect(bootstrap.site).toBe("development.localhost");
  expect(bootstrap.physical_leaves.length).toBeGreaterThan(10);
  const item = await call(page.request, "catalog.operation_item", {
    item_code: "TI-SAMPLE-C-A01",
  });
  expect(item.image).toMatch(/^\/private\/files\//);
  const authorized = await page.request.get(item.image);
  expect(authorized.ok()).toBe(true);
  const guest = await browser.newContext();
  const denied = await guest.request.get(
    new URL(item.image, process.env.NATIVE_BASE_URL || "http://127.0.0.1:8101")
      .href,
    { maxRedirects: 0 },
  );
  expect(denied.status()).toBeGreaterThanOrEqual(400);
  await guest.close();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const font = "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf";
  if (existsSync(font))
    await page.route("**/__native-acceptance-font.otf", (route) =>
      route.fulfill({
        body: readFileSync(font),
        contentType: "font/otf",
      }),
    );
  await page.goto("/inventory/stock");
  await expect(
    page.getByRole("heading", { name: "每一份物资，都有去处。", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stock-card").first()).toBeVisible();
  if (existsSync(font)) {
    await page.addStyleTag({
      content:
        '@font-face { font-family: NativeAudit; src: url("/__native-acceptance-font.otf") } body,button,input,select {font-family:NativeAudit,sans-serif!important}',
    });
    await page.evaluate(() => document.fonts.ready);
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("native-stock-1440.png"),
    fullPage: true,
  });
});

test("routed native destinations load through their real services", async ({
  page,
}) => {
  const errors: string[] = [],
    failed: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.url().includes("/api/method/temple_inventory.") &&
      response.status() >= 400
    )
      failed.push(`${new URL(response.url()).pathname}: ${response.status()}`);
  });
  const routes = [
    "/",
    "/expiry",
    "/movements/items",
    "/movements/records",
    "/loans/items",
    "/loans/records",
    "/loans/MAT-STE-2026-00005",
    "/activities",
    "/item/TI-SAMPLE-N-WORKFLOW",
    "/reports",
    "/counts",
    "/drafts",
    "/pending",
    "/warehouses",
    "/more",
    "/settings",
    "/setup",
    "/documents/Stock%20Entry/MAT-STE-2026-00013",
    "/reconcile/MAT-RECO-2026-00001",
  ];
  for (const route of routes) {
    await page.goto(`/inventory${route}`);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert"), route).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});

test("native operation and count editors mount at mobile with large text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const font = "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf";
  if (existsSync(font))
    await page.route("**/__native-acceptance-font.otf", (route) =>
      route.fulfill({ body: readFileSync(font), contentType: "font/otf" }),
    );
  for (const kind of [
    "Receive",
    "Issue",
    "Transfer",
    "Loan",
    "Return",
    "Damage",
    "Loss",
    "Repair",
    "Disposal",
  ]) {
    await page.goto(`/inventory/new/${kind}`);
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert"), kind).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "复核并确认", exact: true }),
    ).toBeVisible();
  }
  await page.goto("/inventory/reconcile/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/inventory/documents/Stock%20Entry/MAT-STE-2026-00013");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--p-text-scale", "2"),
  );
  if (existsSync(font))
    await page.addStyleTag({
      content:
        '@font-face { font-family: NativeAudit; src: url("/__native-acceptance-font.otf") } body,button,input,select {font-family:NativeAudit,sans-serif!important}',
    });
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByText("1 Box = 5 Nos", { exact: false }).first(),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: test.info().outputPath("native-recorded-factor-375-200.png"),
    fullPage: true,
  });
});

test("queued native CSV/XLSX jobs export the complete catalog into private downloads", async ({
  page,
  browser,
}) => {
  const { newReportQuery } = await import("../../../src/lib/reportContract");
  const query = { ...newReportQuery("inventory"), includeZero: true };
  const preview = await call(page.request, "projections.report_page", {
    query,
    page_length: 1,
  });
  expect(preview.matched_count).toBe(164);
  expect(preview.rows).toHaveLength(1);
  const jobs = [];
  for (const format of ["csv", "xlsx"]) {
    const job = await call(page.request, "exports.request_export", {
      query,
      export_format: format,
      tables: ["summary"],
      include_related: false,
    });
    jobs.push({ format, name: job.name });
  }
  console.log(
    "Native export requests queued; run the native long-queue worker.",
  );
  for (const { format, name } of jobs) {
    let completed: any;
    await expect
      .poll(
        async () => {
          completed = await call(page.request, "exports.export_status", {
            name,
          });
          if (completed.status === "Failed") throw new Error(completed.error);
          return completed.status;
        },
        { timeout: 90000, intervals: [100, 250, 500, 1000] },
      )
      .toBe("Completed");
    expect(completed.row_count).toBe(preview.matched_count);
    const redirect = await page.request.get(completed.download_url, {
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(302);
    const location = redirect.headers()["location"]!;
    expect(location).toMatch(/^\/private\/files\//);
    const download = await page.request.get(location);
    expect(download.ok()).toBe(true);
    const bytes = await download.body();
    if (format === "csv") {
      const text = bytes.toString("utf-8");
      expect(text).toContain("TI-SAMPLE-N-ZERO");
      expect(text.trimEnd().split(/\r?\n/)).toHaveLength(
        preview.matched_count + 1,
      );
    } else {
      const { writeFileSync } = await import("node:fs");
      const { execFileSync } = await import("node:child_process");
      const { resolve } = await import("node:path");
      const path = test.info().outputPath("native-complete-catalog.xlsx");
      writeFileSync(path, bytes);
      const count = execFileSync(
        process.env.NATIVE_PYTHON || resolve("../../../env/bin/python"),
        [
          "-c",
          "import sys,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); print(len(E.fromstring(z.read('xl/worksheets/sheet2.xml')).findall('.//{*}sheetData/{*}row')))",
          path,
        ],
        { encoding: "utf8" },
      );
      expect(Number(count.trim())).toBe(preview.matched_count + 1);
    }
    const guest = await browser.newContext();
    const denied = await guest.request.get(
      new URL(location, process.env.NATIVE_BASE_URL || "http://127.0.0.1:8101")
        .href,
      { maxRedirects: 0 },
    );
    expect(denied.status()).toBeGreaterThanOrEqual(400);
    await guest.close();
  }
});

test("real frontend draft survives a Desk edit, rejects stale input and preserves native children", async ({
  page,
}) => {
  const bootstrap = await call(page.request, "browse.bootstrap");
  const warehouse = bootstrap.physical_leaves.find(
    (name: string) => name.includes("A02") && name.includes("无货位"),
  );
  expect(warehouse).toBeTruthy();
  let name = "";
  try {
    await page.goto(
      `/inventory/new/Receive?warehouse=${encodeURIComponent(warehouse)}&items=${encodeURIComponent(JSON.stringify(["TI-SAMPLE-N-WORKFLOW"]))}`,
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page).toHaveURL(/\/documents\/Stock%20Entry\//);
    name = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    const original = await call(page.request, "native_api.load_document", {
      doctype: "Stock Entry",
      name,
    });
    const child = original.items[0].name;
    const native = await page.request.get(
      `/api/resource/Stock%20Entry/${encodeURIComponent(name)}`,
    );
    expect(native.ok()).toBe(true);
    const deskDoc = (await native.json()).data;
    deskDoc.remarks = "Desk 保存的备注";
    deskDoc.ti_handler_name = "Desk 经手记录";
    const deskSave = await page.request.post("/api/method/frappe.client.save", {
      data: { doc: JSON.stringify(deskDoc) },
      headers: { "X-Frappe-CSRF-Token": csrf },
    });
    expect(deskSave.ok()).toBe(true);
    await page
      .locator("[data-line-id]")
      .first()
      .locator('input[type="number"]')
      .fill("2");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      page.getByText("记录已更改，输入已保留", { exact: true }).first(),
    ).toBeVisible();
    const unchanged = await call(page.request, "native_api.load_document", {
      doctype: "Stock Entry",
      name,
    });
    expect(unchanged.remarks).toBe("Desk 保存的备注");
    expect(unchanged.items[0].qty).toBe(1);
    await expect(page.locator("pre").first()).toContainText('"qty": 2');
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await page
      .getByRole("button", { name: "放弃并重新读取", exact: true })
      .click();
    await page.getByText("补充记录（可选）", { exact: true }).click();
    await expect(page.getByLabel("备注", { exact: true })).toHaveValue(
      "Desk 保存的备注",
    );
    await page.getByLabel("备注", { exact: true }).fill("前端读取 Desk 后保存");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await call(page.request, "native_api.load_document", {
              doctype: "Stock Entry",
              name,
            })
          ).remarks,
      )
      .toBe("前端读取 Desk 后保存");
    const saved = await call(page.request, "native_api.load_document", {
      doctype: "Stock Entry",
      name,
    });
    expect(saved.items[0].name).toBe(child);
    expect(saved.ti_handler_name).toBe("Desk 经手记录");
    expect(saved.docstatus).toBe(0);
    await page.reload();
    await expect(page.locator("[data-line-id]")).toHaveCount(1);
  } finally {
    if (name) {
      const current = await call(page.request, "native_api.load_document", {
        doctype: "Stock Entry",
        name,
      });
      if (current.docstatus === 0)
        await call(page.request, "native_api.delete_document", {
          doctype: "Stock Entry",
          name,
          version: current.version,
        });
    }
  }
});

test("independent HTTP connections create one retry identity and accept only one competing version", async ({
  page,
}) => {
  const bootstrap = await call(page.request, "browse.bootstrap");
  const requestId = crypto.randomUUID();
  const data = {
    company: bootstrap.settings.company,
    ti_movement_kind: "Receive",
    ti_time_mode: "Current",
    ti_source_text: "并发验收临时草稿",
    items: [
      {
        item_code: "TI-SAMPLE-N-WORKFLOW",
        qty: 1,
        uom: "Nos",
        conversion_factor: 1,
        t_warehouse: bootstrap.physical_leaves[0],
        basic_rate: 10,
      },
    ],
  };
  const attempts = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      call(page.request, "native_api.create_document", {
        doctype: "Stock Entry",
        request_id: requestId,
        data,
      }),
    ),
  );
  const results = attempts.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const name = results[0]?.name;
  try {
    expect(results).toHaveLength(3);
    expect(new Set(results.map((doc) => doc.name)).size).toBe(1);
    expect(new Set(results.map((doc) => doc.items[0].name)).size).toBe(1);
    const version = results[0].version;
    const competing = await Promise.all(
      ["并发保存甲", "并发保存乙"].map((remarks) =>
        page.request.post(
          "/api/method/temple_inventory.native_api.save_document",
          {
            data: { doctype: "Stock Entry", name, version, data: { remarks } },
            headers: {
              "X-Frappe-CSRF-Token": csrf,
              "X-Inventory-Account": "Administrator",
            },
          },
        ),
      ),
    );
    expect(competing.filter((response) => response.ok())).toHaveLength(1);
    const rejected = competing.find((response) => !response.ok())!;
    expect((await rejected.json()).exc_type).toBe("TimestampMismatchError");
    const saved = await call(page.request, "native_api.load_document", {
      doctype: "Stock Entry",
      name,
    });
    expect(["并发保存甲", "并发保存乙"]).toContain(saved.remarks);
    expect(saved.docstatus).toBe(0);
  } finally {
    if (name) {
      const current = await call(page.request, "native_api.load_document", {
        doctype: "Stock Entry",
        name,
      });
      await call(page.request, "native_api.delete_document", {
        doctype: "Stock Entry",
        name,
        version: current.version,
      });
    }
  }
});
