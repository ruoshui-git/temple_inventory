import { afterEach, describe, expect, it } from "vitest";
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
async function showAt(top: number) {
  const wrapper = mount(SearchSelect, {
    attachTo: document.body,
    props: { label: "入库位置", modelValue: "", options: ["厨房", "仓库"] },
  });
  wrapper.get("input[role=combobox]").element.getBoundingClientRect = () =>
    rect(top);
  wrapper
    .get("input[role=combobox]")
    .element.dispatchEvent(new FocusEvent("focus"));
  await flushPromises();
  const list = document.querySelector<HTMLElement>(".search-select-menu")!;
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    value: 280,
  });
  window.dispatchEvent(new Event("resize"));
  await flushPromises();
  wrapper && wrappers.push(wrapper);
  return { wrapper, list };
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

describe("SearchSelect popup placement", () => {
  it("anchors the listbox to the input bottom with a four pixel gap", async () => {
    const { list } = await showAt(180);
    expect(Number.parseFloat(list.style.top)).toBe(224);
  });

  it("flips above when the input is near the viewport bottom", async () => {
    const { list } = await showAt(window.innerHeight - 70);
    expect(Number.parseFloat(list.style.top)).toBeLessThan(
      window.innerHeight - 70,
    );
  });
});
