// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type LocationNode,
} from "../src/services/contracts";
import SearchSelect from "../src/components/ui/SearchSelect.vue";

const wrappers: VueWrapper[] = [];
function rect(top: number) {
  return {
    x: 20,
    y: top,
    left: 20,
    top,
    width: 260,
    height: 40,
    right: 280,
    bottom: top + 40,
    toJSON() {},
  } as DOMRect;
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

function mountSelect(props: Record<string, unknown>) {
  const wrapper = mount(SearchSelect, {
    attachTo: document.body,
    props: { label: "位置", modelValue: "", options: [], ...props },
  });
  wrapper.get("input[role=combobox]").element.getBoundingClientRect = () =>
    rect(100);
  wrappers.push(wrapper);
  return wrapper;
}

describe("SearchSelect interactions", () => {
  it("uses an external visible label and can focus its input programmatically", async () => {
    const wrapper = mountSelect({
      externalLabel: true,
      ariaLabelledBy: "section-label",
      options: [{ value: "A", label: "位置 A" }],
    });
    const input = wrapper.get<HTMLInputElement>("input[role=combobox]");
    expect(wrapper.find("label").exists()).toBe(false);
    expect(input.attributes("aria-labelledby")).toBe("section-label");
    (wrapper.vm as unknown as { focus: () => void }).focus();
    await flushPromises();
    expect(document.activeElement).toBe(input.element);
    expect(input.attributes("aria-expanded")).toBe("true");
  });

  it("shows the current value selected until typing starts, then filters the options", async () => {
    const wrapper = mountSelect({
      modelValue: "B",
      options: [
        { value: "A", label: "位置 A" },
        { value: "B", label: "位置 B" },
        { value: "C", label: "位置 C" },
      ],
    });
    const input = wrapper.get<HTMLInputElement>("input[role=combobox]");
    input.element.focus();
    await flushPromises();
    expect(input.element.value).toBe("位置 B");
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(
      document.body.querySelector('[role="option"][aria-selected="true"]')
        ?.textContent,
    ).toContain("位置 B");
    await input.setValue("位置 C");
    await flushPromises();
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(
      document.body.querySelector('[role="option"]')?.textContent,
    ).toContain("位置 C");
  });

  it("moves through teleported options by keyboard, selects, and closes without losing input focus", async () => {
    const wrapper = mountSelect({
      options: [
        { value: "A", label: "位置 A" },
        { value: "B", label: "位置 B" },
      ],
    });
    const input = wrapper.get<HTMLInputElement>("input[role=combobox]");
    input.element.focus();
    await flushPromises();
    const popup = document.body.querySelector<HTMLElement>(
      ".search-select-menu",
    );
    expect(popup).not.toBeNull();

    await input.trigger("keydown", { key: "ArrowDown" });
    expect(
      popup?.querySelector('[role="option"].active')?.textContent,
    ).toContain("位置 B");
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(
      popup?.querySelector('[role="option"].active')?.textContent,
    ).toContain("位置 A");
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([["B"]]);
    expect(input.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(input.element);
  });

  it("closes on Escape while retaining input focus, and lets Tab leave", async () => {
    const wrapper = mountSelect({
      options: [{ value: "A", label: "位置 A" }],
    });
    const input = wrapper.get<HTMLInputElement>("input[role=combobox]");
    const next = document.createElement("button");
    next.textContent = "下一个控件";
    document.body.append(next);
    input.element.focus();
    await flushPromises();
    await input.trigger("keydown", { key: "Escape" });
    expect(document.body.querySelector(".search-select-menu")).toBeNull();
    expect(document.activeElement).toBe(input.element);
    input.element.focus();
    await flushPromises();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.element.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    next.focus();
    await flushPromises();
    expect(document.activeElement).toBe(next);
    expect(document.body.querySelector(".search-select-menu")).toBeNull();
  });

  it("keeps local search open and reveals more rows after 显示更多", async () => {
    const wrapper = mountSelect({
      options: Array.from({ length: 25 }, (_, index) => ({
        value: `warehouse-${index}`,
        label: `位置 ${index}`,
      })),
    });
    const input = wrapper.get("input[role=combobox]");
    input.element.dispatchEvent(new FocusEvent("focus"));
    await input.setValue("位置");
    await flushPromises();
    const popup = document.querySelector<HTMLElement>(".search-select-menu")!;
    const more = popup.querySelector("button")!;
    expect(popup.querySelectorAll('[role="option"]')).toHaveLength(20);
    more.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    more.click();
    await flushPromises();
    expect(popup.querySelectorAll('[role="option"]')).toHaveLength(25);
    expect(
      wrapper.get("input[role=combobox]").attributes("aria-expanded"),
    ).toBe("true");
    expect(
      (wrapper.get("input[role=combobox]").element as HTMLInputElement).value,
    ).toBe("位置");
  });

  it("keeps remote search open when loading more", async () => {
    const loadMore = vi.fn();
    const wrapper = mountSelect({
      remote: true,
      hasMore: true,
      total: 2,
      options: [{ value: "A", label: "位置 A" }],
      onLoadMore: loadMore,
    });
    wrapper
      .get("input[role=combobox]")
      .element.dispatchEvent(new FocusEvent("focus"));
    await wrapper.get("input[role=combobox]").setValue("位置");
    await flushPromises();
    const more = document.querySelector<HTMLElement>(
      ".search-select-menu button",
    )!;
    more.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    more.click();
    await flushPromises();
    expect(loadMore).toHaveBeenCalledOnce();
    expect(
      wrapper.get("input[role=combobox]").attributes("aria-expanded"),
    ).toBe("true");
    expect(
      (wrapper.get("input[role=combobox]").element as HTMLInputElement).value,
    ).toBe("位置");
  });

  it("matches optional warehouse search keywords", async () => {
    const wrapper = mountSelect({
      options: [
        {
          value: "leaf",
          label: "库房 / 货架",
          keywords: "第2寺院 T2",
        },
      ],
    });
    wrapper
      .get("input[role=combobox]")
      .element.dispatchEvent(new FocusEvent("focus"));
    await wrapper.get("input[role=combobox]").setValue("第2寺院");
    await flushPromises();
    expect(
      document.querySelectorAll('.search-select-menu [role="option"]'),
    ).toHaveLength(1);
    expect(
      document
        .querySelector(".search-select-menu .location-label")
        ?.getAttribute("aria-label"),
    ).toBe("库房 / 货架");
    expect(
      document
        .querySelector('.search-select-menu [role="option"]')
        ?.hasAttribute("data-inventory-tip"),
    ).toBe(true);
  });
});

describe("location option matching", () => {
  it("ranks exact code before prefix and preserves order within each tier while typing", async () => {
    const wrapper = mountSelect({
      modelValue: "exact",
      options: [
        { value: "rest1", label: "T1/FUN/B01", detail: "A01 旁" },
        { value: "prefix2", label: "T2/FUN/A01b" },
        { value: "rest2", label: "T2/FUN/B02", detail: "A01 对面" },
        { value: "prefix1", label: "T1/FUN/A01a" },
        {
          value: "exact",
          label: "T2/FUN/A01",
          tip: {
            location: {
              path: "T2/FUN/A01",
              levels: [
                { code: "T2", name: "第2寺院" },
                { code: "FUN", name: "功能区域" },
                { code: "A01", name: "阅览室" },
              ],
            },
          },
        },
      ],
    });
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await flushPromises();
    const options = () =>
      [...document.querySelectorAll('[role="option"]')].map((option) =>
        option
          .querySelector(".location-label")
          ?.textContent?.trim()
          .replace(/\s/g, ""),
      );
    expect(options()).toEqual([
      "T1/FUN/B01",
      "T2/FUN/A01b",
      "T2/FUN/B02",
      "T1/FUN/A01a",
      "T2/FUN/A01",
    ]);
    expect(input.attributes("data-inventory-tip")).toBe("");
    await input.setValue("Ａ01");
    expect(options()).toEqual([
      "T2/FUN/A01",
      "T2/FUN/A01b",
      "T1/FUN/A01a",
      "T1/FUN/B01",
      "T2/FUN/B02",
    ]);
    await input.setValue("阅览室 第2寺院");
    expect(options()).toEqual(["T2/FUN/A01"]);
    await input.setValue("T1 阅览室");
    expect(options()).toEqual([]);
  });

  it("leaves remote results in server order after typing", async () => {
    const wrapper = mountSelect({
      remote: true,
      options: [
        { value: "B", label: "B" },
        { value: "A", label: "A" },
      ],
    });
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await flushPromises();
    await input.setValue("Ａ");
    const options = [...document.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent?.trim(),
    );
    expect(options).toEqual(["B", "A"]);
    expect(wrapper.emitted("search")?.at(-1)).toEqual(["Ａ"]);
  });
});

it("matches a location option's presenter names without caller-supplied keywords or tip", async () => {
  const reference = createReferenceData();
  reference.warehouses = [
    {
      name: "room-native",
      label: "T2/FUN/A01",
      path: "T2/FUN/A01",
      path_segments: ["T2", "FUN", "A01"],
      path_names: ["第2寺院", "功能区域", "阅览室"],
      full_label: "阅览室",
    } as LocationNode,
  ];
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(SearchSelect, {
            label: "位置",
            options: [{ value: "room-native", label: "T2/FUN/A01" }],
          });
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  const input = wrapper.get<HTMLInputElement>("input");
  input.element.getBoundingClientRect = () => rect(100);
  input.element.focus();
  await flushPromises();
  await input.setValue("阅览室 第2寺院");
  expect(document.querySelector('[role="option"]')?.textContent).toContain(
    "A01",
  );
});
