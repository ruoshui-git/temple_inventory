import { flushPromises, type VueWrapper } from "@vue/test-utils";

/** Phone record lists open as rows; switch to the table from the page's "…" menu. */
export async function showPhoneTable(wrapper: VueWrapper) {
  const menu = wrapper.find('[aria-label="更多操作"]');
  if (!menu.exists()) return false;
  await menu.trigger("click");
  await flushPromises();
  const item = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "以表格显示",
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
