// A4 (multi-add timing + network), A12 (picker rail/filter icons), A5 (creation stage), A11 (manual save toast).
import { launch, login, settle, base, OUT, netLog } from "./lib.mjs";
const browser = await launch();
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log("STEP FAIL", name, String(e).slice(0, 300)); } };
try {
  for (const [vp, opts] of [["d", { viewport: { width: 1440, height: 900 }, locale: "zh-CN" }], ["p", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
    const t0 = { t: Date.now() }; const log = netLog(page, t0);
    await page.goto(base + "/movements/new/Receive"); await settle(page, 1500);
    await page.getByRole("button", { name: "添加物品" }).first().click(); await settle(page, 1500);
    await page.screenshot({ path: `${OUT}/a/a4-picker-open-${vp}.png` });
    if (vp === "d") {
      await step("A12 rail", async () => {
        const info = await page.evaluate(() => [...document.querySelectorAll(".preview-item-picker-dialog button")].filter((b) => b.offsetParent).slice(0, 14).map((b) => ({ t: (b.getAttribute("aria-label") || b.textContent).trim().slice(0, 20), icon: b.querySelector("svg use")?.getAttribute("href") || b.querySelector("svg")?.getAttribute("data-icon") || b.querySelector("svg")?.outerHTML.slice(0, 90), r: [b.getBoundingClientRect().x, b.getBoundingClientRect().y, b.getBoundingClientRect().width, b.getBoundingClientRect().height].map(Math.round) })));
        console.log("picker buttons", JSON.stringify(info));
        const toggle = page.locator(".preview-item-picker-dialog button[aria-label*='筛选'], .preview-item-picker-dialog button[aria-label*='侧栏']").first();
        await toggle.click(); await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/a/a12-picker-rail-toggled-${vp}.png` });
        await toggle.click(); await page.waitForTimeout(600);
      });
    }
    // select 6 items
    const boxes = page.locator(".preview-item-picker-dialog tbody input[type=checkbox]");
    if (vp === "p") { console.log("phone row html", (await page.locator(".preview-item-picker-dialog li, .preview-item-picker-dialog article, .preview-item-picker-dialog [role=row]").first().evaluate((e) => e.outerHTML.slice(0, 600)).catch(() => "?"))); }
    if (vp === "d") {
    console.log(vp, "checkboxes", await boxes.count());
    const N = 6;
    for (let i = 0; i < N; i++) { await boxes.nth(i + 20).click(); await page.waitForTimeout(120); }
    await page.screenshot({ path: `${OUT}/a/a4-selected-${vp}.png` });
    const btn = page.getByRole("button", { name: /添加所选/ });
    log.length = 0; t0.t = Date.now();
    await btn.click();
    const tClick = Date.now();
    let rendered = -1, closed = -1; const btnStates = [];
    for (let k = 0; k < 1200; k++) {
      const st = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /添加所选/.test(x.textContent)); return { open: !!document.querySelector(".preview-item-picker-dialog"), lines: document.querySelectorAll("input[data-field=qty]").length, btn: b ? `${b.disabled ? "disabled" : "enabled"}${b.getAttribute("aria-busy") === "true" || b.querySelector(".spinner, [class*=loading]") ? "+busy" : ""}` : "gone" }; });
      const el = Date.now() - tClick;
      if (k % 20 === 0) btnStates.push(`${el}ms open=${st.open} lines=${st.lines} btn=${st.btn}`);
      if (k === 40) await page.screenshot({ path: `${OUT}/a/a4-waiting-${vp}.png` });
      if (closed < 0 && !st.open) closed = el;
      if (st.lines >= N && !st.open) { rendered = el; break; }
      await page.waitForTimeout(50);
    }
    console.log(vp, "A4 picker closed after", closed, "ms; lines rendered after", rendered, "ms");
    console.log(vp, "A4 states", JSON.stringify(btnStates));
    await settle(page, 500);
    console.log(vp, "A4 lines rendered after", rendered, "ms; lines", await page.locator(".preview-allocation").count());
    for (const l of log) console.log("  NET", JSON.stringify(l));
    await page.screenshot({ path: `${OUT}/a/a4-lines-${vp}.png`, fullPage: vp === "d" });
    } else { await page.getByRole("button", { name: "关闭" }).first().tap().catch(() => {}); await page.waitForTimeout(500); }
    // A11 toast via manual save draft
    if (vp === "d") await step("A11 toast", async () => {
      await page.getByRole("button", { name: "保存草稿" }).first().click();
      let toast = null;
      for (let k = 0; k < 60; k++) { toast = await page.evaluate(() => { const t = document.querySelector(".preview-toast"); if (!t || !t.offsetParent) return null; const b = t.getBoundingClientRect(); return { text: t.textContent.trim().slice(0, 60), r: [b.x, b.y, b.width, b.height].map(Math.round), cls: t.className }; }); if (toast) break; await page.waitForTimeout(100); }
      console.log("toast", JSON.stringify(toast), "url", page.url());
      await page.screenshot({ path: `${OUT}/a/a11-toast-${vp}.png` });
    });
    // A5 creation stage
    await step("A5 create", async () => {
      await page.getByRole("button", { name: "添加物品" }).first().click(); await settle(page, 1000);
      await page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建物品" }).first().click(); await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/a/a5-create-${vp}.png` });
      const geo = await page.evaluate(() => { const names = ["取消编辑", "创建并使用物品", "返回选择物品（保留填写）"]; const all = [...document.querySelectorAll(".preview-item-picker-dialog button")]; const dlg = document.querySelector(".preview-item-picker-dialog").getBoundingClientRect(); const sc = document.querySelector(".picker-creation-scroll"); return { vh: innerHeight, dialog: [dlg.x, dlg.y, dlg.width, dlg.height].map(Math.round), scroll: sc ? { sh: sc.scrollHeight, ch: sc.clientHeight, ovf: getComputedStyle(sc).overflowY } : null, buttons: names.map((n) => { const b = all.find((x) => x.textContent.trim() === n); if (!b) return n + ": missing"; const r = b.getBoundingClientRect(); return `${n}: y=${Math.round(r.y)} x=${Math.round(r.x)} w=${Math.round(r.width)} inViewport=${r.bottom <= innerHeight && r.top >= 0} footer=${!!b.closest("footer, .overlay-footer, [class*=footer]")}`; }) }; });
      console.log(vp, "A5 geo", JSON.stringify(geo));
      // full scrolled view: scroll the creation container to bottom
      await page.evaluate(() => { const sc = document.querySelector(".picker-creation-scroll"); let n = sc; while (n && n.scrollHeight <= n.clientHeight + 2) n = n.parentElement; if (n) n.scrollTop = n.scrollHeight; });
      await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/a/a5-create-bottom-${vp}.png` });
      const expiry = page.locator(".preview-item-picker-dialog").getByLabel("记录效期");
      await expiry.scrollIntoViewIfNeeded();
      const batchState = () => page.evaluate(() => { const l = [...document.querySelectorAll(".preview-item-picker-dialog label")].find((x) => /按批次管理/.test(x.textContent)); const i = l?.querySelector("input"); return i ? { checked: i.checked, disabled: i.disabled, text: l.textContent.trim().slice(0, 50) } : "no 按批次管理 label"; });
      console.log(vp, "batch before", JSON.stringify(await batchState()));
      await expiry.check(); await page.waitForTimeout(400);
      console.log(vp, "batch after expiry on", JSON.stringify(await batchState()));
      
      await page.screenshot({ path: `${OUT}/a/a5-expiry-on-${vp}.png` });
      const code = page.locator(".preview-item-picker-dialog").getByLabel("物品编号", { exact: false }).first();
      console.log(vp, "code value", await code.inputValue().catch(() => "?"));
      await code.scrollIntoViewIfNeeded(); await code.fill(""); await code.blur(); await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/a/a5-code-cleared-${vp}.png` });
      const msgs = await page.evaluate(() => [...document.querySelectorAll(".preview-item-picker-dialog [role=alert], .preview-item-picker-dialog .field-error, .preview-item-picker-dialog .error")].map((e) => e.textContent.trim().slice(0, 80)));
      console.log(vp, "after clear msgs", JSON.stringify(msgs));
      await page.getByRole("button", { name: "取消编辑" }).click().catch(() => {}); await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/a/a5-after-cancel-${vp}.png` });
    });
    await ctx.close();
  }
} finally { await browser.close(); }
