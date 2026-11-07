import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
// Real HTTP and the real browser: a Manager imports Opening Stock end to end.
// The workbook is written to the OS temp dir; OPENING_IMPORT_SHOTS saves screenshots.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const shots = process.env.OPENING_IMPORT_SHOTS;
const workdir = mkdtempSync(join(tmpdir(), "ti-opening-import-"));
const baseURL = process.env.NATIVE_BASE_URL!;
test("manager imports Opening Stock as one native document through the wizard", async ({
  browser,
}) => {
  test.skip(
    !process.env.NATIVE_BASE_URL,
    "Requires a live site with the demo accounts",
  );
  test.setTimeout(400000);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await page.request.post("/api/method/login", {
    form: { usr: "manager@example.com", pwd: "admin" },
  });
  const info = (
    await (
      await page.request.get("/api/method/temple_inventory.session.info")
    ).json()
  ).message;
  const call = async (method: string, data = {}) => {
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
    const body = await reply.json();
    expect(reply.ok(), JSON.stringify(body).slice(0, 300)).toBe(true);
    return body.message;
  };
  const boot = await call("browse.bootstrap");
  const leaves = boot.physical_leaves as string[];
  const label = (name: string) =>
    (boot.warehouses as { name: string; label: string }[]).find(
      (row) => row.name === name,
    )?.label || name;
  const tag = crypto.randomUUID().slice(0, 6);
  const make = (data: object) => call("catalog.save_item", { data });
  const plain = await make({
    item_name: `期初导入 普通 ${tag}`,
    stock_uom: "Nos",
  });
  const batch = await make({
    item_name: `期初导入 批次 ${tag}`,
    stock_uom: "Nos",
    has_batch_no: 1,
    has_expiry_date: 1,
  });
  const serial = await make({
    item_name: `期初导入 序列号 ${tag}`,
    stock_uom: "Nos",
    has_serial_no: 1,
  });
  const stocked = (await call("catalog.search_items", { query: "", limit: 1 }))
    ?.items?.[0]?.item_code;
  const rows = JSON.stringify([
    [plain.item_code, label(leaves[0]), "12", "3.5", "", "", "", ""],
    [batch.item_code, leaves[0], "5", "8", `OB-${tag}`, "", "2028-06-30", ""],
    [
      serial.item_code,
      label(leaves[1]),
      "2",
      "",
      "",
      "",
      "",
      `S-${tag}-1；S-${tag}-2`,
    ],
    ["ITM-999998", label(leaves[0]), "1", "", "", "", "", ""],
    [plain.item_code, "不存在的位置", "1", "", "", "", "", ""],
    [stocked || plain.item_code, label(leaves[0]), "3", "", "", "", "", ""],
  ]);
  const file = join(workdir, `opening-${tag}.xlsx`);
  execFileSync("/workspace/development/frappe-bench/env/bin/python", [
    "-c",
    `import json,sys,openpyxl
H=["物品编号*","位置*","数量*","估值单价","批次编号","生产日期","到期日期","序列号"]
b=openpyxl.Workbook(); s=b.active; s.title="期初库存"; s.append(H)
[s.append(r) for r in json.loads(sys.argv[2])]
b.save(sys.argv[1])`,
    file,
    rows,
  ]);
  const ledgerBefore = await call("catalog.operation_items", {
    item_codes: [plain.item_code],
  });
  await page.goto("/inventory/imports/opening");
  await expect(page.getByText("期初日期").first()).toBeVisible();
  await page.waitForTimeout(1000);
  if (shots) await page.screenshot({ path: `${shots}/1440-start.png` });
  await page.getByLabel("时间").fill("00:00:01");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "上传并预览" }).click();
  await expect(page.getByText("无法导入").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(1500);
  if (shots)
    await page.screenshot({
      path: `${shots}/1440-preview.png`,
      fullPage: true,
    });
  const ledgerAfter = await call("catalog.operation_items", {
    item_codes: [plain.item_code],
  });
  expect(ledgerAfter.items[0].stock, "preview must not write").toEqual(
    ledgerBefore.items[0].stock,
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(800);
  if (shots)
    await page.screenshot({ path: `${shots}/390-preview.png`, fullPage: true });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.waitForTimeout(600);
  if (shots) await page.screenshot({ path: `${shots}/1440-confirm.png` });
  await page.getByLabel(/跳过/).check();
  await page.getByRole("button", { name: "提交导入" }).click();
  await expect(page.getByText("导入完成")).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(800);
  if (shots)
    await page.screenshot({ path: `${shots}/1440-result.png`, fullPage: true });
  const link = page.getByRole("link", { name: /MAT-RECO/ }).first();
  const name = (await link.innerText()).trim();
  const native = await call("native_api.load_document", {
    doctype: "Stock Reconciliation",
    name,
  });
  expect(native.docstatus).toBe(1);
  expect(native.purpose).toBe("Opening Stock");
  expect(String(native.posting_time).startsWith("0:00:01")).toBe(true);
  expect(native.items).toHaveLength(3);
  await link.click();
  await expect(page.getByText("期初数量").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(1200);
  if (shots)
    await page.screenshot({
      path: `${shots}/1440-document.png`,
      fullPage: true,
    });
});
