import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("../..", import.meta.url));
const css = ["foundation.css", "browse.css", "data-table.css"]
  .map((file) =>
    readFileSync(path.join(frontendRoot, "src/styles", file), "utf8"),
  )
  .join("\n");

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`icon centering and teleported menu layering at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html><head><style>
			${css}
			body { min-height: 1800px; margin: 0; }
			.fixture-header { position: fixed; inset: 0 0 auto; height: 72px; z-index: var(--p-z-nav); background: var(--p-surface); }
			.fixture-chrome { position: sticky; top: 72px; height: 58px; z-index: var(--p-z-sticky); background: var(--p-canvas); }
			.fixture-popup { display: none; position: fixed; left: 160px; top: 84px; z-index: var(--p-z-menu); }
			.fixture-popup.open { display: block; }
		</style></head><body>
			<header class="fixture-header"><button class="popup-menu-trigger popup-menu-trigger-icon" aria-label="菜单"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 12h16"/></svg></button></header>
			<main><div class="fixture-chrome">粘性搜索工具栏</div><div style="height:1400px"></div></main>
			<div class="fixture-popup browse-action-menu" role="menu"><button type="button" role="menuitem">刷新记录</button><button type="button" role="menuitem">编辑资料</button></div>
			<script>document.querySelector('.popup-menu-trigger').addEventListener('click',()=>document.querySelector('.fixture-popup').classList.toggle('open'))</script>
		</body></html>`);
    await page.evaluate(() => window.scrollTo(0, 240));
    await page.locator(".popup-menu-trigger").click();
    const centering = await page
      .locator(".popup-menu-trigger")
      .evaluate((button) => {
        const box = button.getBoundingClientRect();
        const glyph = button.querySelector("svg")!.getBoundingClientRect();
        return {
          x: Math.abs(
            glyph.left + glyph.width / 2 - (box.left + box.width / 2),
          ),
          y: Math.abs(
            glyph.top + glyph.height / 2 - (box.top + box.height / 2),
          ),
        };
      });
    expect(centering.x).toBeLessThanOrEqual(0.5);
    expect(centering.y).toBeLessThanOrEqual(0.5);
    for (const item of await page
      .locator(".fixture-popup [role=menuitem]")
      .all()) {
      const hit = await item.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
          document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          ) === node
        );
      });
      expect(hit).toBe(true);
    }
  });
}
