import { launch, login, settle, base, DESKTOP } from "../lib.mjs";
const browser = await launch();
try {
 const ctx = await browser.newContext(DESKTOP); const page = await ctx.newPage(); page.setDefaultTimeout(5000); await login(page);
 const candidates = await page.evaluate(async () => {
  const codes=["ITM-000044","ITM-000390","ITM-000210","ITM-000117","ITM-000611","ITM-000049","ITM-000048"];
  const result=[];
  for (const code of codes) {
   try { const [a,b]=await Promise.all([fetch(`/api/method/temple_inventory.catalog.operation_items?item_codes=${encodeURIComponent(JSON.stringify([code]))}`),fetch(`/api/method/temple_inventory.catalog.item_lifecycle?item_code=${encodeURIComponent(code)}`)]); const item=(await a.json()).message?.items?.[0]; const life=(await b.json()).message; if(item&&life) result.push({code,life,stock:item.stock}); } catch{}
  }
  return result;
 });
 console.log("candidates",JSON.stringify(candidates));
 const candidate=candidates.find(x=>x.life.can_delete===true && !x.life.disabled) || candidates.find(x=>!x.life.disabled) || candidates[0];
 if (!candidate) throw new Error("No readable item for lifecycle captures");
 await page.goto(`${base}/stock/items/${candidate.code}`); await settle(page,1200);
 await page.getByRole("button",{name:"物品操作"}).click(); await page.waitForTimeout(250); await page.screenshot({path:"../notes/evidence/2026-10-26-ui-feedback-audit/t3/item-menu-desktop.png"});
 const menu=page.locator(".popup-menu-panel button"); const disable=menu.filter({hasText:/停用物品|启用物品/}).first();
 if(await disable.isEnabled()){await disable.click(); await page.waitForTimeout(350); await page.screenshot({path:"../notes/evidence/2026-10-26-ui-feedback-audit/t3/disable-confirm-desktop.png"}); await page.keyboard.press("Escape"); await page.waitForTimeout(250);}
 await page.getByRole("button",{name:"物品操作"}).click(); await page.waitForTimeout(250); const del=page.locator(".popup-menu-panel button").filter({hasText:"删除物品"}).first();
 if(await del.isEnabled()){await del.click(); await page.waitForTimeout(350); await page.screenshot({path:"../notes/evidence/2026-10-26-ui-feedback-audit/t3/delete-confirm-desktop.png"});}
 await ctx.close();
} finally {await browser.close();}
