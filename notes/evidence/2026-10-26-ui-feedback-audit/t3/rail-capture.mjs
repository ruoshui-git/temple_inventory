import { launch, login, settle, base, DESKTOP } from "../lib.mjs";
const browser = await launch();
try {
	const context = await browser.newContext(DESKTOP);
	const page = await context.newPage();
	await login(page);
	await page.goto(base + "/movements/new/Receive");
	await settle(page, 1000);
	await page.getByRole("button", { name: "添加物品" }).first().click();
	await settle(page, 500);
	await page.locator(".picker-data-table tbody tr").first().waitFor({ timeout: 10000 });
	await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/picker-rail-expanded-desktop.png" });
	await page.locator(".filter-rail-heading button").click();
	await page.waitForTimeout(250);
	await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/picker-rail-collapsed-desktop.png" });
	await context.close();
} finally { await browser.close(); }
