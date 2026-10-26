import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";

const base = "http://development.localhost:8000/inventory";
const out = "notes/evidence/2026-10-26-mobile-audit/after";
const browser = await chromium.launch({
	executablePath: "/usr/bin/chromium-headless-shell",
	args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"],
});

async function loggedInPage(width, height) {
	const context = await browser.newContext({
		viewport: { width, height },
		isMobile: width < 1024,
		hasTouch: width < 1024,
		deviceScaleFactor: width < 1024 ? 2 : 1,
		locale: "zh-CN",
		serviceWorkers: "block",
	});
	const page = await context.newPage();
	await page.goto(`${base}/`);
	await page.evaluate(() =>
		fetch("/api/method/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
		}),
	);
	return { context, page };
}

async function settle(page) {
	await page.waitForLoadState("networkidle").catch(() => {});
	await page.waitForTimeout(2500);
	await page.locator(".skeleton-block, [data-skeleton]").first().waitFor({ state: "hidden", timeout: 12000 }).catch(() => {});
	await page.waitForTimeout(300);
	await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
}

try {
	const { context, page } = await loggedInPage(390, 844);
	const mobile = [
		["records", "/movements?view=records"],
		["damaged-start", "/stock/damaged"],
		["receive-new", "/movements/new/Receive"],
		["categories", "/stock/categories"],
		["counts", "/counts"],
		["reports", "/reports"],
		["d-receive-lines", "/movements/new/Receive?items=%5B%22ITM-000210%22%2C%22ITM-000044%22%5D"],
		["d-movement", "/movements/MAT-STE-2026-01556"],
		["d-item", "/stock/items/ITM-000210"],
	];
	for (const [name, route] of mobile) {
		await page.goto(`${base}${route}`);
		await settle(page);
		await page.screenshot({ path: `${out}/final2-${name}.png` });
		if (name === "damaged-start") {
			await page.evaluate(() => window.scrollTo(0, 850));
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${out}/final2-damaged-scrolled.png` });
		}
		console.log(name, JSON.stringify(await page.evaluate(() => ({
			title: document.querySelector("h1")?.textContent?.trim(),
			tabs: [...document.querySelectorAll(".mobile-context a[aria-current]")].map((a) => ({ label: a.textContent?.trim(), rect: a.getBoundingClientRect().toJSON(), visibility: getComputedStyle(a).visibility })),
			skeletons: document.querySelectorAll(".skeleton-block, [data-skeleton]").length,
			empty: (() => { const e = document.querySelector(".operation-lines-empty"); return e ? { rect: e.getBoundingClientRect().toJSON(), style: { minHeight: getComputedStyle(e).minHeight, justify: getComputedStyle(e).justifyContent, padding: getComputedStyle(e).padding }, children: [...e.children].map((c) => ({ className: c.className, text: c.textContent?.trim().slice(0, 30), rect: c.getBoundingClientRect().toJSON() })) } : undefined; })(),
			hero: (() => { const e = document.querySelector(".browse-detail-image"); const i = e?.querySelector(".item-image-button, .preview-item-image, .async-image"); const m = e?.querySelector(".image-magnifier, .preview-image-enlarge"); return e ? { wrapper: e.getBoundingClientRect().toJSON(), wrapperStyle: getComputedStyle(e).cssText, image: i?.getBoundingClientRect().toJSON(), imageStyle: i ? { width: getComputedStyle(i).width, height: getComputedStyle(i).height, aspect: getComputedStyle(i).aspectRatio } : undefined, magnifier: m?.getBoundingClientRect().toJSON() } : undefined; })(),
		}))));
	}
	await context.close();

	for (const [name, route] of [
		["records-desktop", "/movements?view=records"],
		["receive-editor-desktop", "/movements/new/Receive"],
		["item-detail-desktop", "/stock/items/ITM-000210"],
	]) {
		const { context: desktopContext, page: desktop } = await loggedInPage(1280, 800);
		await desktop.goto(`${base}${route}`);
		await settle(desktop);
		await desktop.screenshot({ path: `${out}/final2-${name}.png` });
		console.log(name, desktop.url());
		await desktopContext.close();
	}
} finally {
	await browser.close();
}
