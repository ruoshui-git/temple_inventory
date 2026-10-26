import { launch, login, settle, base } from "../lib.mjs";
const browser = await launch();
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
	const page = await context.newPage();
	page.setDefaultTimeout(10000);
	await login(page);
	for (let attempt = 0; attempt < 3; attempt++) {
		await page.goto(base + "/movements");
		await settle(page, 1800);
		if (!(await page.getByText("数据正在更新", { exact: false }).count())) break;
		await page.waitForTimeout(1200);
	}
	await page.locator(".data-table-scroll").waitFor({ state: "visible", timeout: 10000 });
	await page.screenshot({ path: "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t5/movements-items.png" });
	console.log(JSON.stringify({ rows: await page.locator(".data-table-scroll tbody tr").count(), updating: await page.getByText("数据正在更新", { exact: false }).count() }));
	await context.close();
} finally {
	await browser.close();
}
