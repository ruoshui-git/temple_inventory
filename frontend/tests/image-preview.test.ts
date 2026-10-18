import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ItemImage from "../src/components/ItemImage.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const item = {
  code: "ITEM-1",
  name: "长名称法会用品",
  image: "/private/files/photo.jpg",
};
function setup(props: Record<string, unknown>) {
  const wrapper = mount(ItemImage, {
    props: { item, ...props },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
describe("shared native Item artwork", () => {
  it("shows the shared accessible fallback without an empty image request", () => {
    const wrapper = setup({ item: { ...item, image: "" } });
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe(
      item.name,
    );
    expect(wrapper.text()).toContain("暂无图片");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("button").exists()).toBe(false);
  });
  it("keeps a stable placeholder after a failed authorized-original request", async () => {
    const wrapper = setup({});
    expect(wrapper.get('[role="img"]').attributes("aria-busy")).toBe("true");
    expect(wrapper.get("img").attributes("src")).toBe(item.image);
    await wrapper.get("img").trigger("error");
    expect(wrapper.text()).toContain("图片加载失败");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it("opens one lightbox, contains focus, and restores the trigger on Escape", async () => {
    const wrapper = setup({});
    const trigger = wrapper.get<HTMLButtonElement>("button.item-image-button");
    trigger.element.focus();
    await trigger.trigger("click");
    await flushPromises();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(item.name);
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(item.image);
    expect(document.activeElement).toBe(dialog);
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
  });
  it("separates detail navigation from enlarge and dismisses a stale image after Item changes", async () => {
    const wrapper = setup({ interaction: "detail" });
    await wrapper.get("button.preview-image-detail").trigger("click");
    expect(wrapper.emitted("detail")).toEqual([[]]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await wrapper.get("button.preview-image-enlarge").trigger("click");
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(wrapper.emitted("detail")).toHaveLength(1);
    await wrapper.setProps({
      item: { code: "ITEM-2", name: "其它物品", image: "" },
    });
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      wrapper.get("button.preview-image-detail").attributes("aria-label"),
    ).toContain("其它物品");
    expect(wrapper.find("button.preview-image-enlarge").exists()).toBe(false);
  });
});
