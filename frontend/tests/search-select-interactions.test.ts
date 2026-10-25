import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
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
      document.querySelector('.search-select-menu [role="option"]')
        ?.textContent,
    ).toContain("库房 / 货架");
  });
});
