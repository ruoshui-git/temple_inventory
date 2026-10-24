import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";

const base = "http://development.localhost:8000";
const enc = encodeURIComponent;
const pages = {
	expiry: "/inventory/stock/expiry",
	warehouses: "/inventory/stock/warehouses",
	damaged: "/inventory/stock/damaged",
	categories: "/inventory/stock/categories",
	batch: `/inventory/stock/batches/${enc("ITM-000001 BAT 000001")}`,
	"mv-items": "/inventory/movements?view=items",
	"mv-detail": "/inventory/movements/MAT-STE-2026-00004",
	"loans-items": "/inventory/loans?view=items",
	"loan-detail": "/inventory/loans/MAT-STE-2026-01530",
	counts: "/inventory/counts",
	"count-detail": "/inventory/counts/MAT-RECO-2026-00001",
	reports: "/inventory/reports",
	activities: "/inventory/activities",
	"activity-detail": "/inventory/activities/vknupp7j6e",
	drafts: "/inventory/drafts",
	more: "/inventory/more",
	settings: "/inventory/settings",
	notifications: "/inventory/notifications",
};
const widths = { 1440: 900, 1024: 768, 390: 844 };
const errors = [];
const browser = await chromium.launch({
	executablePath: "/usr/bin/chromium-headless-shell",
	args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"],
});
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(base + "/login");
	await page.evaluate(async () => {
		await fetch("/api/method/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
		});
	});
	for (const [width, height] of Object.entries(widths)) {
		await page.setViewportSize({ width: Number(width), height });
		for (const [name, path] of Object.entries(pages)) {
			try {
				await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
				await page.waitForTimeout(500);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth,
				);
				if (overflow > 1) errors.push(`${name}@${width} horizontal page overflow ${overflow}px`);
			} catch (error) {
				errors.push(`${name}@${width} ${String(error).split("\n")[0]}`);
			}
		}
	}
	await context.close();
} finally {
	await browser.close();
}
fs.writeFileSync(new URL("./overflow.txt", import.meta.url), errors.join("\n"));
console.log("checked", Object.keys(pages).length * Object.keys(widths).length, "page/viewport pairs;", errors.length, "issues");
