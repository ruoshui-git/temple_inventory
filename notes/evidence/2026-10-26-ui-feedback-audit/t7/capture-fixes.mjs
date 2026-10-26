import { mkdir } from "node:fs/promises";
import { chromium, expect } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
import { base, launch, login } from "../lib.mjs";

const output = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t7";
await mkdir(output, { recursive: true });
const browser = await launch();
const token = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
const codes = Array.from({ length: 5 }, (_, i) => `T7FIX-${token}-${i + 1}`);
let csrf = "";
let bootstrap;
let page;
async function api(method, data = {}) {
  return page.evaluate(async ({ method, data, csrf }) => {
    const r = await fetch(`/api/method/temple_inventory.${method}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": csrf, "X-Inventory-Account": "Administrator" }, body: JSON.stringify(data),
    });
    const b = await r.json();
    if (!r.ok || b.exc_type) throw new Error(`${method}: ${b.exception || b.exc_type || r.status}`);
    return b.message;
  }, { method, data, csrf });
}
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}-fix.jpg`, fullPage: false, animations: "disabled", type: "jpeg", quality: 80 });
}
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN", serviceWorkers: "block" });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  await login(page);
  csrf = (await page.evaluate(async () => (await (await fetch("/api/method/temple_inventory.session.info")).json()).message)).csrf_token;
  bootstrap = await api("browse.bootstrap");
  for (let i = 0; i < codes.length; i++) {
    await api("catalog.save_item", { data: { item_code: codes[i], item_name: `T7 polish item ${i + 1} ${token}`, stock_uom: "Nos", has_batch_no: i < 3 ? 1 : 0, has_expiry_date: 0 } });
  }
  const query = new URLSearchParams({ warehouse: bootstrap.physical_leaves[0], items: JSON.stringify(codes) });
  await page.goto(new URL(`/inventory/movements/new/Receive?${query}`, base).href);
  await expect(page.locator(".allocation-card")).toHaveCount(5);
  const destination = page.getByRole("combobox", { name: /入库位置/ });
  const warehouse = bootstrap.warehouses.find((w) => w.name === bootstrap.physical_leaves[0]);
  await destination.fill(warehouse?.label || bootstrap.physical_leaves[0]);
  await page.getByRole("option").filter({ hasText: warehouse?.label || bootstrap.physical_leaves[0] }).first().click();
  for (const width of [390, 360]) {
    const height = width === 390 ? 844 : 740;
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { window.scrollTo(0, 0); for (const e of document.querySelectorAll("*")) e.scrollTop = 0; });
    await capture(`movement-toolbar-${width}x${height}`);
    await page.locator(".allocation-card").filter({ hasText: codes[0] }).scrollIntoViewIfNeeded();
    await capture(`movement-card-header-${width}x${height}`);
  }
  await page.goto(new URL("/inventory/movements/new/Receive", base).href);
  await page.locator(".preview-operation-lines").getByRole("button", { name: "添加物品" }).first().click();
  const picker = page.getByRole("dialog").last();
  await picker.getByRole("button", { name: "新建物品" }).first().click();
  await expect(page.locator(".picker-creation-scroll")).toBeVisible();
  for (const width of [390, 360]) {
    const height = width === 390 ? 844 : 740;
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { window.scrollTo(0, 0); for (const e of document.querySelectorAll("*")) e.scrollTop = 0; });
    await capture(`item-create-phone-${width}x${height}`);
  }
} finally {
  if (page && csrf) {
    for (const code of codes) {
      try {
        await page.evaluate(async ({ code, csrf }) => fetch("/api/method/frappe.client.delete", { method: "POST", headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": csrf }, body: JSON.stringify({ doctype: "Item", name: code }) }), { code, csrf });
      } catch (error) { console.warn(`cleanup ${code}: ${String(error)}`); }
    }
  }
  await page?.context().close();
  await browser.close();
}
