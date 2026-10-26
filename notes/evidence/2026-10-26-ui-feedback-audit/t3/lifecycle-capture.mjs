import { launch, login, settle, base, DESKTOP } from "../lib.mjs";
const browser = await launch();
try {
	const ctx = await browser.newContext(DESKTOP);
	const page = await ctx.newPage();
	page.setDefaultTimeout(10000);
	await login(page);
	await page.goto(base + "/stock/items/new");
	await settle(page, 800);
	const name = page.locator("#item-name");
	await name.fill(`T3 临时生命周期截图 ${Date.now()}`);
	await page.getByRole("button", { name: "保存物品" }).click();
	await page.waitForURL(/\/stock\/items\/[^/]+$/, { timeout: 20000 });
	await settle(page, 1000);
	const code = page.url().split("/").at(-1);
	console.log("temporary item", code);
	await page.getByRole("button", { name: "物品操作" }).click();
	await page.waitForTimeout(200);
	await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/item-menu-available-desktop.png" });
	await page.locator(".popup-menu-panel button").filter({ hasText: "停用物品" }).click();
	await page.waitForTimeout(250);
	await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/disable-confirm-desktop.png" });
	await page.keyboard.press("Escape");
	await page.waitForTimeout(250);
	await page.getByRole("button", { name: "物品操作" }).click();
	await page.waitForTimeout(200);
	await page.locator(".popup-menu-panel button").filter({ hasText: "删除物品" }).click();
	await page.waitForTimeout(250);
	await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/delete-confirm-desktop.png" });
	await page.locator(".preview-dialog .dialog-footer button").last().click();
	await page.waitForURL(/\/stock(?:\?|$)/, { timeout: 20000 });
	await settle(page, 600);
	await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/deleted-stock-toast-desktop.png" });
	await ctx.close();
} finally {
	await browser.close();
}
