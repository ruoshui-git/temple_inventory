// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import AppFrame from "../src/components/AppFrame.vue";
import {
  primaryNavigation,
  mobilePrimaryNavigation,
  inventoryNavigation,
  moreNavigation,
  destinationForRoute,
  inventorySectionForRoute,
} from "../src/lib/appNavigation";
import { routeTarget } from "../src/lib/routeRegistry";
import { router } from "../src/router";

const wrappers: VueWrapper[] = [];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  if (originalScrollIntoView)
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

describe("shared application frame", () => {
  it("keeps reports under More instead of primary navigation", () => {
    expect(primaryNavigation.map(({ label }) => label)).not.toContain("报表");
    expect(mobilePrimaryNavigation.map(({ label }) => label)).not.toContain(
      "报表",
    );
    expect(
      moreNavigation.flatMap(({ items }) => items.map(({ label }) => label)),
    ).toContain("报表");
  });
  it("measures desktop and mobile navigation obstructions independently and observes responsive height changes", async () => {
    let change: ((event: { matches: boolean }) => void) | undefined;
    let observed: Element[] = [];
    let resize: ResizeObserverCallback | undefined;
    const media = {
      matches: true,
      addEventListener: vi.fn((_name, callback) => {
        change = callback;
      }),
      removeEventListener: vi.fn(),
    };
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn((target: Element) => observed.push(target));
      disconnect = vi.fn(() => {
        observed = [];
      });
      unobserve = vi.fn();
    }
    vi.stubGlobal("matchMedia", () => media);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    document.documentElement.style.setProperty("--app-nav-height", "91px");
    document.documentElement.style.setProperty(
      "--app-desktop-nav-height",
      "73px",
    );
    const wrapper = mount(AppFrame, {
      global: { plugins: [router] },
      props: {
        primary: primaryNavigation,
        mobilePrimary: mobilePrimaryNavigation,
        inventory: inventoryNavigation,
        user: "volunteer",
        active: "inventory",
        inventoryExpanded: false,
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    const desktop = wrapper.find(".app-sidebar");
    let desktopHeight = 82;
    vi.spyOn(desktop.element, "getBoundingClientRect").mockImplementation(
      () => ({ height: desktopHeight }) as DOMRect,
    );
    window.dispatchEvent(new Event("resize"));
    expect(
      document.documentElement.style.getPropertyValue(
        "--app-desktop-nav-height",
      ),
    ).toBe("82px");
    expect(
      document.documentElement.style.getPropertyValue("--app-nav-height"),
    ).toBe("0px");
    expect(observed).toContain(desktop.element);

    desktopHeight = 104;
    resize?.([], {} as ResizeObserver);
    expect(
      document.documentElement.style.getPropertyValue(
        "--app-desktop-nav-height",
      ),
    ).toBe("104px");

    media.matches = false;
    change?.({ matches: false });
    await flushPromises();
    const mobile = wrapper.find(".app-mobile-nav");
    let mobileHeight = 58;
    vi.spyOn(mobile.element, "getBoundingClientRect").mockImplementation(
      () => ({ height: mobileHeight }) as DOMRect,
    );
    window.dispatchEvent(new Event("resize"));
    expect(
      document.documentElement.style.getPropertyValue(
        "--app-desktop-nav-height",
      ),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue("--app-nav-height"),
    ).toBe("58px");
    expect(observed).toContain(mobile.element);
    expect(observed).not.toContain(desktop.element);

    mobileHeight = 66;
    resize?.([], {} as ResizeObserver);
    expect(
      document.documentElement.style.getPropertyValue("--app-nav-height"),
    ).toBe("66px");
    wrapper.unmount();
    wrappers.pop();
    expect(
      document.documentElement.style.getPropertyValue("--app-nav-height"),
    ).toBe("91px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--app-desktop-nav-height",
      ),
    ).toBe("73px");
  });

  it("keeps the mobile shell and input through a breakpoint change, and exposes the desktop Inventory menu accessibly", async () => {
    let change: ((event: { matches: boolean }) => void) | undefined;
    const remove = vi.fn(),
      media = {
        matches: false,
        addEventListener: vi.fn((_name, callback) => {
          change = callback;
        }),
        removeEventListener: remove,
      };
    vi.stubGlobal("matchMedia", () => media);
    const wrapper = mount(AppFrame, {
      global: { plugins: [router] },
      props: {
        primary: primaryNavigation,
        mobilePrimary: mobilePrimaryNavigation,
        inventory: inventoryNavigation,
        user: "volunteer",
        active: "inventory",
        inventoryExpanded: false,
      },
      slots: { default: '<input aria-label="未完成输入" />' },
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.findAll('nav[aria-label="应用主导航"]')).toHaveLength(1);
    expect(wrapper.find(".app-mobile-nav").exists()).toBe(true);
    expect(
      wrapper.get('.app-mobile-nav a[aria-current="page"]').text(),
    ).toContain("库存");
    expect(wrapper.find(".app-account-menu").exists()).toBe(false);
    expect(wrapper.findAll(".app-mobile-nav button")).toHaveLength(0);
    expect(
      wrapper
        .findAll(".app-mobile-nav a")
        .map((link) => link.attributes("href")),
    ).toEqual(
      mobilePrimaryNavigation.map((item) => router.resolve(item.route).href),
    );
    await wrapper.find("input").setValue("保留输入");
    media.matches = true;
    change?.({ matches: true });
    await flushPromises();
    expect(wrapper.findAll('nav[aria-label="应用主导航"]')).toHaveLength(1);
    expect(wrapper.find(".app-sidebar").exists()).toBe(true);
    expect(wrapper.find(".app-account-menu").exists()).toBe(true);
    expect(
      wrapper.findAll(".app-sidebar > nav > .nav-group > :is(button, a)"),
    ).toHaveLength(5);
    // Only the 库存 disclosure stays a button; every destination is a real link.
    expect(
      wrapper.findAll(".app-sidebar > nav > .nav-group > button"),
    ).toHaveLength(1);
    expect(
      wrapper
        .findAll(".app-sidebar > nav > .nav-group > a")
        .map((link) => link.attributes("href")),
    ).toEqual(
      primaryNavigation
        .filter((item) => item.key !== "inventory")
        .map((item) => router.resolve(item.route).href),
    );
    await wrapper.find(".nav-group a").trigger("click", { ctrlKey: true });
    await wrapper.find(".nav-group a").trigger("click", { button: 1 });
    expect(wrapper.emitted("primary")).toBeUndefined();
    expect(wrapper.find(".inventory-menu").exists()).toBe(false);
    expect(wrapper.find("input").element.value).toBe("保留输入");
    await wrapper.find(".nav-group a").trigger("click");
    expect(wrapper.emitted("primary")?.at(-1)).toEqual([routeTarget("home")]);
    const trigger = wrapper.find("[data-inventory-menu-trigger]");
    await trigger.trigger("pointerdown");
    await trigger.trigger("click");
    expect(wrapper.emitted("primary")).toHaveLength(1);
    expect(wrapper.emitted("update:inventoryExpanded")?.at(-1)).toEqual([true]);
    await wrapper.setProps({ inventoryExpanded: true });
    expect(
      wrapper.find("[data-inventory-menu-trigger]").attributes("aria-expanded"),
    ).toBe("true");
    expect(trigger.attributes("aria-controls")).toBe("inventory-menu");
    expect(wrapper.findAll(".inventory-menu a")).toHaveLength(4);
    expect(wrapper.get(".inventory-menu a").attributes("href")).toBe(
      router.resolve(inventoryNavigation[0]!.route).href,
    );
    await wrapper.find(".inventory-menu a").trigger("click", { metaKey: true });
    expect(wrapper.emitted("inventory")).toBeUndefined();
    await wrapper.find(".inventory-menu a").trigger("click");
    expect(wrapper.emitted("inventory")?.at(-1)).toEqual([
      inventoryNavigation[0]!.route,
    ]);
    wrapper.unmount();
    wrappers.pop();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("opens an accessible desktop account menu and restores focus after Escape", async () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    const wrapper = mount(AppFrame, {
      global: { plugins: [router] },
      props: {
        primary: primaryNavigation,
        mobilePrimary: mobilePrimaryNavigation,
        inventory: inventoryNavigation,
        user: "volunteer",
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.findAll(".app-account-trigger")).toHaveLength(1);
    const trigger = wrapper.get(".app-account-trigger");
    expect(
      wrapper.element.querySelector(".app-account-menu")?.parentElement,
    ).toBe(wrapper.element.querySelector(".app-sidebar"));
    expect(trigger.attributes("aria-haspopup")).toBe("menu");
    await trigger.trigger("click");
    expect(wrapper.get("[role=menu]").text()).toContain("volunteer");
    await document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await wrapper.get('[role="menuitem"]').trigger("click");
    await flushPromises();
    expect(document.querySelector(".ui-dialog")?.textContent).toContain(
      "退出当前账户后",
    );
    document.querySelector<HTMLButtonElement>(".dialog-footer button")?.click();
    await flushPromises();
    expect(document.querySelector(".ui-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
  });

  it("assigns top navigation and Inventory menu sections from route metadata", () => {
    expect(destinationForRoute("inventory")).toBe("inventory");
    expect(destinationForRoute("movements")).toBe("movements");
    expect(destinationForRoute("loans")).toBe("loans");
    expect(destinationForRoute("reports")).toBe("more");
    expect(destinationForRoute("more")).toBe("more");
    expect(inventorySectionForRoute("expiry")).toBe("expiry");
    expect(inventorySectionForRoute("pending")).toBe("pending");
    expect(inventorySectionForRoute("warehouse-detail")).toBe("warehouses");
  });
});
