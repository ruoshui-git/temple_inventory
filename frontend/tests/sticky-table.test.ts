// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import BrowseToolbar from "../src/components/ui/BrowseToolbar.vue";
import DataTable from "../src/components/ui/DataTable.vue";
import type { DataColumn, DataTableEntry } from "../src/lib/dataTable";

const wrappers: VueWrapper[] = [];

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--app-desktop-nav-height");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const columns: DataColumn[] = [
  { id: "item", label: "物品", required: true },
  { id: "quantity", label: "数量" },
];
const rows: DataTableEntry[] = [
  {
    kind: "record",
    id: "row-1",
    value: { item: "灯笼", quantity: 3 },
  },
];

describe("sticky column header", () => {
  it("is off by default and leaves the scroll region unmarked", () => {
    const wrapper = mount(DataTable, {
      props: { ariaLabel: "库存", columns, rows },
    });
    wrappers.push(wrapper);
    const scroll = wrapper.get(".data-table-scroll");
    expect(scroll.classes()).not.toContain("is-sticky-header");
  });

  it("adds is-sticky-header to the scroll region when the prop is set", async () => {
    const wrapper = mount(DataTable, {
      props: { ariaLabel: "库存", columns, rows, stickyHeader: true },
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.get(".data-table-scroll").classes()).toContain(
      "is-sticky-header",
    );
    expect(wrapper.get(".data-table").attributes("style")).toContain(
      "--data-table-head-height",
    );
  });

  it("keeps the table markup identical apart from the sticky class", async () => {
    const plain = mount(DataTable, {
      props: { ariaLabel: "库存", columns, rows },
    });
    const sticky = mount(DataTable, {
      props: { ariaLabel: "库存", columns, rows, stickyHeader: true },
    });
    wrappers.push(plain, sticky);
    await flushPromises();
    const plainTable = plain.get("table").html();
    const stickyTable = sticky.get("table").html();
    expect(stickyTable.replace(/ data-v-[\w-]+=""/g, "")).toBe(
      plainTable.replace(/ data-v-[\w-]+=""/g, ""),
    );
  });
});

describe("browse toolbar sticky offset", () => {
  function stubRects(heights: Record<string, number>) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = Object.entries(heights).find(([className]) =>
          this.classList.contains(className),
        )?.[1];
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 0,
          bottom: height ?? 0,
          width: 0,
          height: height ?? 0,
          toJSON() {},
        } as DOMRect;
      },
    );
  }

  function mountToolbar(desktop: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 599px)" ? !desktop : false,
      addEventListener() {},
      removeEventListener() {},
    }));
    document.documentElement.style.setProperty(
      "--app-desktop-nav-height",
      "64px",
    );
    const host = document.createElement("div");
    document.body.append(host);
    const wrapper = mount(BrowseToolbar, {
      attachTo: host,
      props: { title: "库存", summary: "库存 · 30 种" },
    });
    wrappers.push(wrapper);
    // The toolbar publishes on its parent element, which is the test-utils mount container.
    return { parent: wrapper.element.parentElement as HTMLElement, wrapper };
  }

  it("publishes nav height plus the whole sticky chrome on desktop", async () => {
    stubRects({ "browse-chrome": 56, "browse-persistent-bar": 40 });
    const { parent } = mountToolbar(true);
    await flushPromises();
    expect(parent.style.getPropertyValue("--browse-sticky-bottom")).toBe(
      "120px",
    );
    expect(parent.style.getPropertyValue("--browse-toolbar-height")).toBe(
      "56px",
    );
  });

  it("publishes nav height plus only the persistent bar on phones", async () => {
    stubRects({ "browse-chrome": 140, "browse-persistent-bar": 52 });
    const { parent } = mountToolbar(false);
    await flushPromises();
    expect(parent.style.getPropertyValue("--browse-sticky-bottom")).toBe(
      "116px",
    );
  });

  it("removes the published offset on unmount", async () => {
    stubRects({ "browse-chrome": 56 });
    const { parent, wrapper } = mountToolbar(true);
    await flushPromises();
    expect(parent.style.getPropertyValue("--browse-sticky-bottom")).not.toBe(
      "",
    );
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(parent.style.getPropertyValue("--browse-sticky-bottom")).toBe("");
    expect(parent.style.getPropertyValue("--browse-toolbar-height")).toBe("");
  });
});
