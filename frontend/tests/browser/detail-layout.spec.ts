import { expect, test } from "@playwright/test";

test("batch details keep their header first and stay stacked at wide widths", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.innerHTML = `
			<section class="browse-page batch-detail-page">
				<header class="app-page-header">Detail header</header>
				<article class="batch-detail-card">Facts</article>
				<article class="batch-detail-card">Locations</article>
				<article class="batch-detail-card">History and lines</article>
			</section>`;
    document.body.append(fixture);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = await page.locator(".batch-detail-page").evaluate((node) => {
    const cards = Array.from(
      node.querySelectorAll<HTMLElement>(".batch-detail-card"),
    );
    return {
      headerTop: node.querySelector(".app-page-header")!.getBoundingClientRect()
        .top,
      firstTop: cards[0]!.getBoundingClientRect().top,
      secondTop: cards[1]!.getBoundingClientRect().top,
      thirdTop: cards[2]!.getBoundingClientRect().top,
    };
  });
  expect(wide.headerTop).toBeLessThan(wide.firstTop);
  expect(wide.secondTop).toBeGreaterThan(wide.firstTop);
  expect(wide.thirdTop).toBeGreaterThan(wide.secondTop);
  await page.setViewportSize({ width: 1024, height: 900 });
  const narrow = await page.locator(".batch-detail-page").evaluate((node) => {
    const cards = Array.from(
      node.querySelectorAll<HTMLElement>(".batch-detail-card"),
    );
    return {
      secondTop: cards[1]!.getBoundingClientRect().top,
      firstBottom: cards[0]!.getBoundingClientRect().bottom,
    };
  });
  expect(narrow.secondTop).toBeGreaterThanOrEqual(narrow.firstBottom);
});

test("item and loan histories share a column only when wide enough", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.innerHTML = `
			<article class="browse-detail-card item-detail-card">
				<div class="item-detail-top">Facts</div>
				<section class="item-detail-inventory">Inventory</section>
				<details class="item-detail-history" open><summary>History</summary></details>
			</article>
			<section class="loan-detail-page">
				<article class="browse-detail-card">
					<div class="browse-card-heading">Identity</div><p class="browse-note">Facts</p>
					<dl class="loan-key-facts">Facts</dl>
					<details class="loan-history-section" open><summary>History</summary></details>
					<div class="loan-detail-main"><div class="loan-lines">Lines and actions</div></div>
				</article>
			</section>`;
    document.body.append(fixture);
  });
  await page.setViewportSize({ width: 1920, height: 900 });
  const wide = await page.evaluate(() => {
    const inventory = document.querySelector(".item-detail-inventory")!;
    const itemHistory = document.querySelector(".item-detail-history")!;
    const loanMain = document.querySelector(".loan-lines")!;
    const loanHistory = document.querySelector(".loan-history-section")!;
    return {
      itemColumns: getComputedStyle(inventory).gridColumn,
      itemInventoryX: inventory.getBoundingClientRect().x,
      itemHistoryX: itemHistory.getBoundingClientRect().x,
      loanMainX: loanMain.getBoundingClientRect().x,
      loanHistoryX: loanHistory.getBoundingClientRect().x,
    };
  });
  expect(wide.itemColumns).toBe("1");
  expect(wide.itemHistoryX).toBeGreaterThan(wide.itemInventoryX);
  expect(wide.loanHistoryX).toBeGreaterThan(wide.loanMainX);

  await page.setViewportSize({ width: 1440, height: 900 });
  const stacked = await page.evaluate(() => ({
    itemInventory: document
      .querySelector(".item-detail-inventory")!
      .getBoundingClientRect(),
    itemHistory: document
      .querySelector(".item-detail-history")!
      .getBoundingClientRect(),
    loanMain: document.querySelector(".loan-lines")!.getBoundingClientRect(),
    loanHistory: document
      .querySelector(".loan-history-section")!
      .getBoundingClientRect(),
  }));
  expect(stacked.itemHistory.y).toBeGreaterThanOrEqual(
    stacked.itemInventory.bottom,
  );
  expect(stacked.loanMain.y).toBeGreaterThanOrEqual(stacked.loanHistory.bottom);
});

test("off-screen browse cards use content visibility across a 600-row list", async ({
  page,
}) => {
  await page.goto("/");
  const timings = await page.evaluate(async () => {
    const list = document.createElement("div");
    list.className = "browse-card-grid";
    list.style.cssText = "height:600px;overflow:auto;display:block";
    list.innerHTML = Array.from(
      { length: 600 },
      (_, index) =>
        `<article class="browse-card-item browse-card-item--card">库存记录 ${index + 1}</article>`,
    ).join("");
    document.body.append(list);
    const rows = Array.from(list.children) as HTMLElement[];
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    async function measure(
      density: "xcompact" | "spacious",
      forceVisible: boolean,
    ) {
      document.documentElement.dataset.tiDensity = density;
      rows.forEach(
        (row) => (row.style.contentVisibility = forceVisible ? "visible" : ""),
      );
      await frame();
      const started = performance.now();
      list.getBoundingClientRect();
      list.scrollTop = list.scrollHeight;
      void rows.at(-1)!.getBoundingClientRect().bottom;
      document.documentElement.dataset.tiDensity =
        density === "xcompact" ? "spacious" : "xcompact";
      await frame();
      list.scrollTop = 0;
      void rows[0]!.getBoundingClientRect().bottom;
      return performance.now() - started;
    }
    const before = await measure("xcompact", true);
    const after = await measure("xcompact", false);
    const applied = getComputedStyle(rows[0]!).contentVisibility;
    list.remove();
    return { before, after, applied, count: rows.length };
  });
  console.log(
    `600-row browse layout/scroll: visible=${timings.before.toFixed(2)}ms auto=${timings.after.toFixed(2)}ms`,
  );
  expect(timings.count).toBe(600);
  expect(timings.applied).toBe("auto");
  expect(Number.isFinite(timings.before + timings.after)).toBe(true);
});
