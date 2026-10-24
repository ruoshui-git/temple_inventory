import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PopupMenu from "../src/components/ui/PopupMenu.vue";

const wrappers: VueWrapper[] = [];
function rect(left: number, top: number, width = 40, height = 30) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {},
  } as DOMRect;
}
function mountMenu(label = "操作菜单") {
  const wrapper = mount(PopupMenu, {
    attachTo: document.body,
    props: { label, align: "end" },
    slots: { default: "<button>第一项</button><button>第二项</button>" },
  });
  wrapper.get(".popup-menu-trigger").element.getBoundingClientRect = () =>
    rect(100, 100);
  wrappers.push(wrapper);
  return wrapper;
}
async function open(wrapper: VueWrapper) {
  await wrapper.get(".popup-menu-trigger").trigger("click");
  await flushPromises();
  await Promise.resolve();
  return document.querySelector<HTMLElement>(".popup-menu-panel")!;
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PopupMenu", () => {
  it("opens below its anchor with a four pixel gap", async () => {
    const wrapper = mountMenu();
    const panel = await open(wrapper);
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 120,
    });
    window.dispatchEvent(new Event("resize"));
    await flushPromises();
    expect(Number.parseFloat(panel.style.top)).toBe(134);
    expect(panel.getAttribute("role")).toBe("menu");
  });

  it("flips above when there is more room above", async () => {
    const wrapper = mountMenu();
    wrapper.get(".popup-menu-trigger").element.getBoundingClientRect = () =>
      rect(100, 700);
    const panel = await open(wrapper);
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 160,
    });
    window.dispatchEvent(new Event("resize"));
    await flushPromises();
    expect(Number.parseFloat(panel.style.top)).toBeLessThan(700);
  });

  it("clamps horizontally when its anchor is near the right edge", async () => {
    const wrapper = mountMenu();
    wrapper.get(".popup-menu-trigger").element.getBoundingClientRect = () =>
      rect(window.innerWidth - 10, 100);
    const panel = await open(wrapper);
    panel.getBoundingClientRect = () => rect(0, 0, 220);
    window.dispatchEvent(new Event("resize"));
    await flushPromises();
    expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(
      window.innerWidth - 228,
    );
  });

  it("closes on outside pointerdown", async () => {
    const wrapper = mountMenu();
    await open(wrapper);
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(wrapper.get(".popup-menu-trigger").attributes("aria-expanded")).toBe(
      "false",
    );
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    const wrapper = mountMenu();
    await open(wrapper);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.get(".popup-menu-trigger").attributes("aria-expanded")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(
      wrapper.get(".popup-menu-trigger").element,
    );
  });

  it("moves focus between menu items with arrow keys", async () => {
    const wrapper = mountMenu();
    const panel = await open(wrapper);
    const first = panel.querySelectorAll("button")[0]!;
    const second = panel.querySelectorAll("button")[1]!;
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(second);
    second.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(document.activeElement).toBe(first);
  });

  it("keeps only one menu open at a time", async () => {
    const first = mountMenu("第一菜单");
    const second = mountMenu("第二菜单");
    await first.get(".popup-menu-trigger").trigger("click");
    await second.get(".popup-menu-trigger").trigger("click");
    await flushPromises();
    expect(first.get(".popup-menu-trigger").attributes("aria-expanded")).toBe(
      "false",
    );
    expect(second.get(".popup-menu-trigger").attributes("aria-expanded")).toBe(
      "true",
    );
  });

  it("closes on route change", async () => {
    const wrapper = mountMenu();
    await open(wrapper);
    document.dispatchEvent(new Event("inventory-navigation"));
    await flushPromises();
    expect(wrapper.get(".popup-menu-trigger").attributes("aria-expanded")).toBe(
      "false",
    );
  });
});
