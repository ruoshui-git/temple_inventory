import { flushPromises, type VueWrapper } from "@vue/test-utils";

/** Clicks a "…" menu item by its visible text; false when the menu or item is absent. */
async function clickOverflowItem(wrapper: VueWrapper, text: string) {
  const menu = wrapper.find('[aria-label="更多操作"]');
  if (!menu.exists()) return false;
  await menu.trigger("click");
  await flushPromises();
  const item = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!item) {
    await menu.trigger("click");
    await flushPromises();
    return false;
  }
  item.click();
  await flushPromises();
  return true;
}

/**
 * Phone 单据 lists (活动, 盘点记录, 草稿, 货物流动/借用 单据) switch to the table from the page's
 * "…" menu (以表格显示). Phone 物品 pages and desktop keep the summary-row toggle (表格视图).
 */
export async function showPhoneTable(wrapper: VueWrapper) {
  const toggle = wrapper.find(
    '.browse-summary-controls button[aria-label="表格视图"]',
  );
  if (toggle.exists()) {
    await toggle.trigger("click");
    await flushPromises();
    return true;
  }
  return clickOverflowItem(wrapper, "以表格显示");
}

/**
 * Opens 显示字段 for the layout on screen: the summary-row trigger for tables and phone item
 * pages, or the "…" menu item for phone 单据 rows. The panel teleports to body.
 */
export async function openColumnSettings(wrapper: VueWrapper) {
  const trigger = wrapper.find(
    ".browse-summary-controls .data-table-column-trigger, .data-table-column-trigger",
  );
  if (trigger.exists()) {
    await trigger.trigger("click");
    await flushPromises();
    return true;
  }
  return clickOverflowItem(wrapper, "显示字段");
}
