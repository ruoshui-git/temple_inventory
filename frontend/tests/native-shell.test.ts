// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import AppFrame from "../src/components/AppFrame.vue";
import {
  primaryNavigation,
  mobilePrimaryNavigation,
  inventoryNavigation,
  destinationForRoute,
  inventorySectionForRoute,
} from "../src/lib/appNavigation";
import { routeTarget } from "../src/lib/routeRegistry";

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
    document.documentElement.style.setProperty("--preview-nav-height", "91px");
    document.documentElement.style.setProperty(
      "--preview-desktop-nav-height",
      "73px",
    );
    const wrapper = mount(AppFrame, {
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

    const desktop = wrapper.find(".sample-sidebar");
    let desktopHeight = 82;
    vi.spyOn(desktop.element, "getBoundingClientRect").mockImplementation(
      () => ({ height: desktopHeight }) as DOMRect,
    );
    window.dispatchEvent(new Event("resize"));
    expect(
      document.documentElement.style.getPropertyValue(
        "--preview-desktop-nav-height",
      ),
    ).toBe("82px");
    expect(
      document.documentElement.style.getPropertyValue("--preview-nav-height"),
    ).toBe("0px");
    expect(observed).toContain(desktop.element);

    desktopHeight = 104;
    resize?.([], {} as ResizeObserver);
    expect(
      document.documentElement.style.getPropertyValue(
        "--preview-desktop-nav-height",
      ),
    ).toBe("104px");

    media.matches = false;
    change?.({ matches: false });
    await flushPromises();
    const mobile = wrapper.find(".sample-mobile-nav");
    let mobileHeight = 58;
    vi.spyOn(mobile.element, "getBoundingClientRect").mockImplementation(
      () => ({ height: mobileHeight }) as DOMRect,
    );
    window.dispatchEvent(new Event("resize"));
    expect(
      document.documentElement.style.getPropertyValue(
        "--preview-desktop-nav-height",
      ),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue("--preview-nav-height"),
    ).toBe("58px");
    expect(observed).toContain(mobile.element);
    expect(observed).not.toContain(desktop.element);

    mobileHeight = 66;
    resize?.([], {} as ResizeObserver);
    expect(
      document.documentElement.style.getPropertyValue("--preview-nav-height"),
    ).toBe("66px");
    wrapper.unmount();
    wrappers.pop();
    expect(
      document.documentElement.style.getPropertyValue("--preview-nav-height"),
    ).toBe("91px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--preview-desktop-nav-height",
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
    expect(wrapper.find(".sample-mobile-nav").exists()).toBe(true);
    expect(
      wrapper.get('.sample-mobile-nav button[aria-current="page"]').text(),
    ).toContain("库存");
    expect(wrapper.find(".app-account-menu").exists()).toBe(false);
    expect(wrapper.findAll(".sample-mobile-nav button")).toHaveLength(6);
    await wrapper.find("input").setValue("保留输入");
    media.matches = true;
    change?.({ matches: true });
    await flushPromises();
    expect(wrapper.findAll('nav[aria-label="应用主导航"]')).toHaveLength(1);
    expect(wrapper.find(".sample-sidebar").exists()).toBe(true);
    expect(wrapper.find(".app-account-menu").exists()).toBe(true);
    expect(
      wrapper.findAll(".sample-sidebar > nav > .nav-group > button"),
    ).toHaveLength(6);
    expect(wrapper.find(".inventory-menu").exists()).toBe(false);
    expect(wrapper.find("input").element.value).toBe("保留输入");
    await wrapper.find(".nav-group button").trigger("click");
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
    expect(wrapper.findAll(".inventory-menu button")).toHaveLength(4);
    await wrapper.find(".inventory-menu button").trigger("click");
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
    ).toBe(wrapper.element.querySelector(".sample-sidebar"));
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
    expect(document.querySelector(".preview-dialog")?.textContent).toContain(
      "退出当前账户后",
    );
    document.querySelector<HTMLButtonElement>(".dialog-footer button")?.click();
    await flushPromises();
    expect(document.querySelector(".preview-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
  });

  it("assigns top navigation and Inventory menu sections from route metadata", () => {
    expect(destinationForRoute("inventory")).toBe("inventory");
    expect(destinationForRoute("movements")).toBe("movements");
    expect(destinationForRoute("loans")).toBe("loans");
    expect(destinationForRoute("reports")).toBe("reports");
    expect(destinationForRoute("more")).toBe("more");
    expect(inventorySectionForRoute("expiry")).toBe("expiry");
    expect(inventorySectionForRoute("pending")).toBe("pending");
    expect(inventorySectionForRoute("warehouse-detail")).toBe("warehouses");
  });
});
