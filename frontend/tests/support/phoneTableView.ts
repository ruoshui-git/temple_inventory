import { flushPromises, type VueWrapper } from "@vue/test-utils";

/**
 * Switches a page's browse layout to the table through the summary-row 表格视图 toggle, which
 * every phone and desktop browse page renders. False when the toggle is absent.
 */
export async function showPhoneTable(wrapper: VueWrapper) {
  const toggle = wrapper.find(
    '.browse-summary-controls button[aria-label="表格视图"]',
  );
  if (!toggle.exists()) return false;
  await toggle.trigger("click");
  await flushPromises();
  return true;
}

/**
 * Opens 显示字段 for the layout on screen: the inline summary-row trigger for 列表 rows, or the
 * trigger a mounted table renders in its own header. The panel teleports to body.
 */
export async function openColumnSettings(wrapper: VueWrapper) {
  const trigger = wrapper.find(
    ".browse-summary-controls .data-table-column-trigger, .data-table-column-trigger",
  );
  if (!trigger.exists()) return false;
  await trigger.trigger("click");
  await flushPromises();
  return true;
}
