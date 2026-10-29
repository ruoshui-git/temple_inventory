// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import DataTable from "../src/components/ui/DataTable.vue";
import ReportTable from "../src/components/ui/ReportTable.vue";
import { useColumnPreferences } from "../src/composables/useColumnPreferences";
import {
  moveColumn,
  reconcileColumns,
  dataColumnAlignment,
  dataColumnKind,
  dataColumnPreset,
  type DataColumn,
} from "../src/lib/dataTable";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.useRealTimers();
  window.localStorage.clear();
});

const columns: DataColumn[] = [
  { id: "item", label: "物品", required: true, sortable: true },
  { id: "quantity", label: "数量", sortable: true },
  { id: "retired", label: "旧列", defaultVisible: true },
];

describe("table column contracts", () => {
  it("measures horizontal overflow edges and scrolls by most of the visible width", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const wrapper = mount(DataTable, {
      props: { ariaLabel: "横向表格", columns, rows: [] },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const scroll = wrapper.get<HTMLElement>(".data-table-scroll").element;
    const headerCells = wrapper.findAll<HTMLElement>("thead th");
    headerCells[0]!.element.style.position = "sticky";
    headerCells[0]!.element.style.left = "0px";
    headerCells[0]!.element.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 35,
        bottom: 30,
        width: 35,
        height: 30,
        toJSON() {},
      }) as DOMRect;
    headerCells[2]!.element.style.position = "sticky";
    headerCells[2]!.element.style.right = "0px";
    headerCells[2]!.element.getBoundingClientRect = () =>
      ({
        x: 410,
        y: 0,
        left: 410,
        top: 0,
        right: 500,
        bottom: 30,
        width: 90,
        height: 30,
        toJSON() {},
      }) as DOMRect;
    scroll.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 500,
        bottom: 200,
        width: 500,
        height: 200,
        toJSON() {},
      }) as DOMRect;
    let frameTop = 0;
    Object.defineProperty(
      wrapper.get<HTMLElement>(".data-table-frame").element,
      "offsetParent",
      {
        configurable: true,
        value: document.body,
      },
    );
    wrapper.get<HTMLElement>(
      ".data-table-frame",
    ).element.getBoundingClientRect = () =>
      ({
        x: 0,
        y: frameTop,
        left: 0,
        top: frameTop,
        right: 500,
        bottom: frameTop + 200,
        width: 500,
        height: 200,
        toJSON() {},
      }) as DOMRect;
    const scrollBy = vi.fn();
    Object.defineProperties(scroll, {
      scrollWidth: { configurable: true, value: 900 },
      clientWidth: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: 60 },
      scrollBy: { configurable: true, value: scrollBy },
    });
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(scroll.classList.contains("is-overflow-start")).toBe(true);
    expect(scroll.classList.contains("is-overflow-end")).toBe(true);
    const hint = wrapper.get(".data-table-overflow-hint-end");
    expect(hint.attributes("aria-label")).toBe("向右滚动查看更多列");
    expect(hint.attributes("title")).toBe("更多列");
    expect(hint.find("svg").exists()).toBe(true);
    expect(hint.text()).toBe("");
    expect(hint.attributes("style")).toContain("right: 622px");
    expect(
      wrapper.get(".data-table-overflow-hint-start").attributes("style"),
    ).toContain("left: 43px");
    expect(hint.attributes("style")).toContain("top: 100px");
    await hint.trigger("click");
    expect(scrollBy).toHaveBeenCalledWith({ left: 400, behavior: "smooth" });
    const leftHint = wrapper.get(".data-table-overflow-hint-start");
    expect(leftHint.attributes("aria-label")).toBe("向左滚动查看更多列");
    await leftHint.trigger("click");
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -400,
      behavior: "smooth",
    });
    frameTop = 200;
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();
    expect(
      wrapper.get(".data-table-overflow-hint-start").attributes("style"),
    ).toContain("top: 300px");
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      value: 400,
    });
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(scroll.classList.contains("is-overflow-start")).toBe(true);
    expect(scroll.classList.contains("is-overflow-end")).toBe(false);
  });

  it("uses frame edge fades and an external settings control on phones", async () => {
    const priorWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches:
          query.includes("max-width") || query.includes("max-width: 1023px")
            ? true
            : false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const controller = {
      order: ref(["item", "quantity", "retired"]),
      visible: ref(["item", "quantity", "retired"]),
      saveState: ref("saved"),
      saveError: ref(""),
      reset: vi.fn(),
      toggle: vi.fn(),
      reorder: vi.fn(),
      retry: vi.fn(),
    };
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "手机表格",
        columns,
        rows: [],
        columnPreferences: controller as never,
      },
    });
    wrappers.push(wrapper);
    const scroll = wrapper.get<HTMLElement>(".data-table-scroll").element;
    Object.defineProperties(scroll, {
      scrollWidth: { configurable: true, value: 900 },
      clientWidth: { configurable: true, value: 390 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(
      wrapper
        .findAll(".data-table-overflow-hint")
        .every((hint) => hint.attributes("aria-hidden") === "true"),
    ).toBe(true);
    expect(scroll.classList.contains("is-overflow-end")).toBe(true);
    expect(
      wrapper
        .find(
          "thead th.data-table-settings-heading button[aria-label='设置列']",
        )
        .exists(),
    ).toBe(true);
    expect(wrapper.get(".data-table-frame").attributes("style")).toContain(
      "--data-table-pinned-end: 0px",
    );
    scroll.scrollLeft = 300;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(scroll.classList.contains("is-overflow-start")).toBe(true);
    expect(scroll.classList.contains("is-overflow-end")).toBe(true);
    Object.defineProperty(window, "innerWidth", priorWidth!);
  });

  it("unpins an end column group only after it crosses the phone-width threshold", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("max-width"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "窄表格",
        columns: [
          {
            id: "actions",
            label: "操作",
            className: "report-sticky-actions-column",
          },
        ],
        rows: [],
      },
    });
    wrappers.push(wrapper);
    const scroll = wrapper.get<HTMLElement>(".data-table-scroll").element;
    const header = wrapper.get<HTMLElement>("thead th").element;
    header.style.position = "sticky";
    header.style.right = "0px";
    let pinnedWidth = 130;
    header.getBoundingClientRect = () =>
      ({
        left: 390 - pinnedWidth,
        right: 390,
        width: pinnedWidth,
        top: 0,
        bottom: 30,
        height: 30,
      }) as DOMRect;
    scroll.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 390,
        width: 390,
        top: 0,
        bottom: 200,
        height: 200,
      }) as DOMRect;
    Object.defineProperties(scroll, {
      scrollWidth: { configurable: true, value: 900 },
      clientWidth: { configurable: true, value: 390 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(scroll.classList.contains("is-mobile-unpin-end")).toBe(false);
    pinnedWidth = 150;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(scroll.classList.contains("is-mobile-unpin-end")).toBe(true);
    expect(wrapper.get(".data-table-frame").attributes("style")).toContain(
      "--data-table-pinned-end: 0px",
    );
  });

  it("does not show desktop arrows for a table without a visible layout box", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const wrapper = mount(DataTable, {
      props: { ariaLabel: "隐藏表格", columns, rows: [] },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const frame = wrapper.get<HTMLElement>(".data-table-frame").element;
    frame.style.display = "none";
    const scroll = wrapper.get<HTMLElement>(".data-table-scroll").element;
    Object.defineProperties(scroll, {
      scrollWidth: { configurable: true, value: 900 },
      clientWidth: { configurable: true, value: 390 },
    });
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextTick();
    expect(
      wrapper
        .findAll(".data-table-overflow-hint")
        .every((hint) => hint.attributes("aria-hidden") === "true"),
    ).toBe(true);
  });

  it("focuses a row on pointer interaction without changing horizontal scroll", async () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "可聚焦表格",
        columns,
        rows: [{ kind: "record", id: "row-1", value: { item: "物品" } }],
      },
    });
    wrappers.push(wrapper);
    const scroll = wrapper.get<HTMLElement>(".data-table-scroll").element;
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 120,
    });
    const row = wrapper.get<HTMLTableRowElement>(
      "tbody tr[data-row-id]",
    ).element;
    const focus = vi.spyOn(row, "focus");
    row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll.scrollLeft).toBe(120);
  });

  it("aligns quantity columns and group metrics with tabular numeric cells", () => {
    expect(dataColumnAlignment({ id: "quantities", label: "数量" })).toBe(
      "start",
    );
    expect(dataColumnAlignment({ id: "stock_qty", label: "数量" })).toBe("end");
    expect(dataColumnAlignment({ id: "item_code", label: "物品编码" })).toBe(
      "start",
    );
    expect(dataColumnAlignment({ id: "image", label: "图片" })).toBe("center");
  });

  it("maps semantic column kinds to their sizing classes", () => {
    for (const kind of [
      "number",
      "unit",
      "code",
      "date",
      "datetime",
      "status",
      "chip",
      "thumb",
      "actions",
      "text",
      "primary",
    ] as const) {
      const preset = dataColumnPreset({ id: kind, label: kind, kind });
      expect(preset).toEqual({
        kind,
        className: `data-column-${kind}`,
      });
    }
    expect(dataColumnKind({ id: "item_name", label: "物品名称" })).toBe(
      "primary",
    );
    expect(dataColumnKind({ id: "stock_uom", label: "库存单位" })).toBe("unit");
    expect(dataColumnKind({ id: "available", label: "可用" })).toBe("number");
  });

  it("gives only the first primary column the flexible width", () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "名称列",
        columns: [
          { id: "item_name", label: "物品名称" },
          { id: "title", label: "记录名称" },
        ],
        rows: [],
      },
    });
    expect(
      wrapper
        .findAll("thead th")
        .map((cell) =>
          cell
            .classes()
            .find((className) => className.startsWith("data-column-")),
        ),
    ).toEqual(["data-column-primary", "data-column-text"]);
    wrapper.unmount();
  });

  it("keeps keyboard focus through column reorder and returns it after Escape", async () => {
    const controller = {
      order: ref(["item", "quantity", "retired"]),
      visible: ref(["item", "quantity", "retired"]),
      saveState: ref("saved"),
      saveError: ref(""),
      reset: vi.fn(),
      toggle: vi.fn(),
      reorder(order: string[]) {
        this.order.value = order;
      },
      retry: vi.fn(),
    };
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "键盘排序表格",
        columns,
        rows: [],
        columnPreferences: controller as never,
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const trigger = wrapper.get<HTMLButtonElement>(
      'button[aria-label="设置列"]',
    );
    await trigger.trigger("click");
    const moveUp = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="上移数量"]',
    )!;
    moveUp.focus();
    moveUp.click();
    await nextTick();
    expect(controller.order.value).toEqual(["quantity", "item", "retired"]);
    const movedColumnDown = document.body.querySelector<HTMLButtonElement>(
      'button[data-column-move="quantity"][data-column-direction="1"]',
    )!;
    expect(movedColumnDown.disabled).toBe(false);
    expect(document.activeElement).toBe(movedColumnDown);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(document.body.querySelector(".data-table-column-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
  });

  it("reconciles new, retired, duplicate, hidden and required columns", () => {
    expect(
      reconcileColumns(columns, {
        order: ["quantity", "retired", "quantity", "gone"],
        hidden: ["item", "quantity", "gone"],
      }),
    ).toEqual({
      order: ["quantity", "retired", "item"],
      visible: ["retired", "item"],
    });
    expect(
      reconcileColumns(columns, {
        order: ["item", "quantity", "retired"],
        hidden: ["item", "quantity", "retired"],
      }).visible,
    ).toEqual(["item"]);
    expect(
      reconcileColumns(
        [
          ...columns,
          { id: "optional_new", label: "新可选列", defaultVisible: false },
        ],
        { order: ["item", "quantity", "retired"], hidden: ["quantity"] },
      ).visible,
    ).toEqual(["item", "retired"]);
  });

  it("moves only columns with an in-range keyboard step", () => {
    const initial = ["item", "quantity", "retired"];
    expect(moveColumn(initial, "quantity", -1)).toEqual([
      "quantity",
      "item",
      "retired",
    ]);
    expect(moveColumn(initial, "item", -1)).toBe(initial);
  });

  it("keeps the column settings panel inside a short viewport near the bottom edge", async () => {
    const priorHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const priorWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1366,
    });
    const columnPreferences = {
      order: ref(["item", "quantity"]),
      visible: ref(["item", "quantity"]),
      saveState: ref("saved"),
      saveError: ref(""),
      reset: vi.fn(),
      toggle: vi.fn(),
      reorder: vi.fn(),
      retry: vi.fn(),
    } as never;
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "短屏表格",
        columns,
        rows: [],
        columnPreferences,
      },
    });
    wrappers.push(wrapper);
    const trigger = wrapper.get('button[aria-label="设置列"]');
    vi.spyOn(trigger.element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(1280, 550, 44, 44),
    );
    await trigger.trigger("click");
    const panelElement = document.body.querySelector<HTMLElement>(
      ".data-table-column-panel",
    )!;
    expect(panelElement.parentElement).toBe(document.body);
    const panel = { element: panelElement };
    vi.spyOn(panel.element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 300, 360),
    );
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
    const top = Number.parseFloat((panel.element as HTMLElement).style.top);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + 360).toBeLessThanOrEqual(window.innerHeight - 12);
    expect((panel.element as HTMLElement).style.position).toBe("fixed");
    Object.defineProperty(window, "innerHeight", priorHeight!);
    Object.defineProperty(window, "innerWidth", priorWidth!);
  });
});

describe("shared data table", () => {
  it("roves focus through record and group rows, supports row commands, and clamps after filtering", async () => {
    const rows = [
      { kind: "record" as const, id: "A", value: { item: "A" } },
      {
        kind: "group" as const,
        id: "G",
        label: "组",
        depth: 0,
        count: 1,
        expanded: false,
        hasChildren: true,
      },
      { kind: "record" as const, id: "B", value: { item: "B" } },
    ];
    const linkClick = vi.fn();
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "键盘表格",
        columns,
        rows,
        selectionEnabled: true,
        selectedKeys: [],
      },
      slots: {
        cell: ({ row }: { row: Record<string, unknown> }) =>
          h(
            "a",
            {
              class: "browse-row-link",
              href: "#",
              onClick: (event: Event) => {
                event.preventDefault();
                linkClick();
              },
            },
            String(row.item),
          ),
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    const rowElements = () => wrapper.findAll("tbody tr[data-row-id]");
    expect(rowElements().map((row) => row.attributes("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
    ]);

    rowElements()[0]!.element.focus();
    rowElements()[0]!.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(rowElements()[1]!.element);
    rowElements()[1]!.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(wrapper.emitted("toggleGroup")).toBeUndefined();
    rowElements()[1]!.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(wrapper.emitted("toggleGroup")).toHaveLength(1);
    rowElements()[1]!.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(wrapper.emitted("toggleGroup")).toHaveLength(2);

    rowElements()[1]!.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(rowElements()[2]!.element);
    rowElements()[2]!.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(rowElements()[0]!.element);
    rowElements()[0]!.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(linkClick).toHaveBeenCalledOnce();
    rowElements()[0]!.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["A", true]);

    const checkbox = wrapper.get('input[aria-label="选择记录 A"]');
    checkbox.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(rowElements()[0]!.element);

    rowElements()[2]!.element.focus();
    await wrapper.setProps({ rows: [rows[0]!] });
    await nextTick();
    expect(rowElements()[0]!.attributes("tabindex")).toBe("0");
    expect(document.activeElement).toBe(rowElements()[0]!.element);
  });

  it("shows a shape-matched initial skeleton and keeps headers usable over retained stale rows", async () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "异步结果表格",
        columns: [
          { id: "item", label: "物品", sortable: true },
          { id: "image", label: "图片" },
          { id: "stock_qty", label: "数量", sortable: true },
        ],
        rows: [],
        loading: true,
        initialized: false,
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.findAll(".data-table-skeleton-row")).toHaveLength(5);
    expect(wrapper.get(".data-table-skeleton-row").findAll("td")).toHaveLength(
      3,
    );
    expect(wrapper.get('[aria-label="物品排序：未排序"]').text()).toContain(
      "↕",
    );
    expect(
      wrapper
        .get('[aria-label="物品排序：未排序"] .data-table-sort-label')
        .element.nextElementSibling?.classList.contains(
          "data-table-sort-indicator",
        ),
    ).toBe(true);
    expect(
      wrapper
        .get('[aria-label="数量排序：未排序"] .data-table-sort-label')
        .element.nextElementSibling?.classList.contains(
          "data-table-sort-indicator",
        ),
    ).toBe(true);
    expect(wrapper.get("th.align-start").attributes("aria-sort")).toBe("none");
    expect(
      wrapper.get("th.align-center").attributes("aria-sort"),
    ).toBeUndefined();
    expect(wrapper.get("th.align-end").attributes("aria-sort")).toBe("none");

    await wrapper.setProps({
      rows: [{ kind: "record", id: "A", value: { item: "A" } }],
      loading: true,
      initialized: true,
      retained: true,
      stale: true,
    });
    expect(wrapper.findAll(".data-table-skeleton-row")).toHaveLength(0);
    expect(wrapper.get(".data-table-refresh-status").attributes("role")).toBe(
      "status",
    );
    expect(wrapper.get(".data-table-refresh-status").classes()).toContain(
      "sr-only",
    );
    expect(wrapper.get(".data-table-scroll").attributes("aria-busy")).toBe(
      "true",
    );
    expect(wrapper.get("tbody").attributes()).toHaveProperty("inert");
    await wrapper.get('[aria-label="物品排序：未排序"]').trigger("click");
    expect(wrapper.emitted("sort")?.[0]).toEqual(["item"]);
  });

  it("discloses a whole group row while embedded controls keep their own action", async () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "分组表格",
        columns,
        rows: [
          {
            kind: "group",
            id: "group-row",
            label: "甲类",
            depth: 1,
            count: 2,
            expanded: true,
            hasChildren: true,
            detailRow: true,
          },
        ],
      },
      slots: {
        group: () =>
          h(
            "button",
            { type: "button", class: "independent-control" },
            "查看历史",
          ),
      },
    });
    wrappers.push(wrapper);
    const row = wrapper.get("tbody tr");
    await row.trigger("click");
    expect(wrapper.emitted("toggleGroup")?.[0]).toEqual(["group-row"]);
    await row.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("toggleGroup")).toHaveLength(2);
    await wrapper.get(".independent-control").trigger("click");
    expect(wrapper.emitted("toggleGroup")).toHaveLength(2);
    expect(row.attributes("aria-expanded")).toBe("true");
  });

  it("keeps column settings in the trailing header during empty and loading states", () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "空结果表格",
        columns,
        rows: [],
        loading: true,
        initialized: false,
        columnPreferences: {
          order: ref(["item", "quantity"]),
          visible: ref(["item", "quantity"]),
          saveState: ref("saved"),
          saveError: ref(""),
          toggle: vi.fn(),
          reorder: vi.fn(),
          reset: vi.fn(),
          retry: vi.fn(),
        } as never,
      },
    });
    wrappers.push(wrapper);
    const settingsHeader = wrapper.get(
      'thead th:has(button[aria-label="设置列"])',
    );
    expect(settingsHeader.element).toBe(
      wrapper.findAll("thead th").at(-1)?.element,
    );
    expect(wrapper.get('button[aria-label="设置列"]').exists()).toBe(true);
  });

  it("emits sort, selection and lazy group intent while exposing retained states", async () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "测试表格",
        columns,
        rows: [
          {
            kind: "group",
            id: "group-1",
            label: "甲类",
            depth: 0,
            count: 2,
            expanded: false,
            hasChildren: true,
          },
          {
            kind: "record",
            id: "item-1",
            value: { item: "纸张", quantity: 3 },
          },
        ],
        selectionEnabled: true,
        selectedKeys: [],
        loading: true,
        initialized: true,
        retained: true,
        stale: true,
        error: "网络暂不可用",
        hasMore: true,
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.get(".data-table-group-identity-cell").exists()).toBe(true);
    await wrapper.get(".data-table-sort").trigger("click");
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await wrapper.get('input[aria-label="选择记录 item-1"]').setValue(true);
    await wrapper.get(".data-table-more button").trigger("click");
    await wrapper.get(".data-table-refresh-error button").trigger("click");
    expect(wrapper.emitted("sort")?.[0]).toEqual(["item"]);
    expect(wrapper.emitted("toggleGroup")?.[0]).toEqual(["group-1"]);
    expect(wrapper.emitted("select")?.[0]).toEqual(["item-1", true]);
    expect(wrapper.emitted("loadMore")).toHaveLength(1);
    expect(wrapper.emitted("retry")).toHaveLength(1);
    expect(wrapper.get(".data-table-refresh-status").text()).toContain(
      "保留当前结果，更新完成后可用",
    );
    expect(wrapper.text()).toContain("网络暂不可用");
  });

  it("does not prevent native Space behavior for a control inside a group row", async () => {
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "可展开分组",
        columns,
        rows: [
          {
            kind: "group",
            id: "group-row",
            label: "物品",
            depth: 0,
            count: 1,
            expanded: true,
            hasChildren: true,
          },
        ],
      },
      slots: {
        group: () => h("button", { type: "button" }, "原生按钮"),
      },
    });
    wrappers.push(wrapper);
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    wrapper.get("tbody tr button").element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("toggleGroup")).toBeUndefined();
  });

  it("saves column visibility through the per-account server preference contract", async () => {
    vi.useFakeTimers();
    const reference = createReferenceData();
    Object.assign(reference, { site: "table-test.local", user: "table-user" });
    const call = vi.fn(
      async (method: string, args?: Record<string, unknown>) => {
        if (method.endsWith("get_column_preferences")) return undefined;
        return args?.preference;
      },
    );
    const root = defineComponent({
      setup() {
        const services = { call, report: vi.fn(), upload: vi.fn() };
        provideInventoryServices(services, reference);
        const columnPreferences = useColumnPreferences(
          "reports.preference-test",
          ref(columns),
          reference,
          services,
        );
        return () =>
          h(DataTable, {
            ariaLabel: "偏好表格",
            columns,
            rows: [
              {
                kind: "record",
                id: "item-1",
                value: { item: "纸张", quantity: 3 },
              },
            ],
            columnPreferences,
          });
      },
    });
    const wrapper = mount(root);
    wrappers.push(wrapper);
    await flushPromises();
    await wrapper.get('button[aria-label="设置列"]').trigger("click");
    const quantityInput = document.body.querySelectorAll<HTMLInputElement>(
      '.data-table-column-panel input[type="checkbox"]',
    )[1]!;
    quantityInput.checked = false;
    quantityInput.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(call).toHaveBeenCalledWith(
      "table_preferences.save_column_preferences",
      {
        table_id: "reports.preference-test",
        preference: {
          order: ["item", "quantity", "retired"],
          hidden: ["quantity"],
        },
      },
    );
    expect(
      wrapper
        .findAll("thead th")
        .filter((cell) => !cell.find('[aria-label="设置列"]').exists())
        .map((cell) => cell.text()),
    ).toEqual(["物品↕", "旧列"]);
  });

  it("cancels a queued old-account save and serializes later same-table saves", async () => {
    vi.useFakeTimers();
    const reference = createReferenceData();
    Object.assign(reference, { site: "race-test.local", user: "first-user" });
    const pending: Array<{
      args: Record<string, unknown>;
      resolve: (value: unknown) => void;
    }> = [];
    const call = vi.fn((method: string, args: Record<string, unknown>) => {
      if (method.endsWith("get_column_preferences"))
        return Promise.resolve(undefined);
      return new Promise((resolve) => pending.push({ args, resolve }));
    });
    let controller!: ReturnType<typeof useColumnPreferences>;
    const root = defineComponent({
      setup() {
        controller = useColumnPreferences(
          "reports.race-test",
          ref(columns),
          reference,
          {
            call,
            report: vi.fn(),
            upload: vi.fn(),
          },
        );
        return () => h("div");
      },
    });
    const wrapper = mount(root);
    wrappers.push(wrapper);
    await flushPromises();
    controller.toggle("retired");
    reference.user = "second-user";
    await nextTick();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(120);
    expect(pending).toHaveLength(0);

    controller.toggle("retired");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(pending).toHaveLength(1);
    controller.toggle("quantity");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(pending[0]!.args.preference);
    await flushPromises();
    expect(pending).toHaveLength(2);
    expect(pending[1]!.args.preference).toEqual({
      order: ["item", "quantity", "retired"],
      hidden: ["quantity", "retired"],
    });
    pending[1]!.resolve(pending[1]!.args.preference);
    await flushPromises();
  });

  it("re-hydrates report preferences when the report table purpose changes", async () => {
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "report-purpose.local",
      user: "report-user",
    });
    const tableId = ref("reports.inventory.summary");
    const call = vi.fn(
      async (method: string, args: Record<string, unknown>) => {
        if (method.endsWith("get_column_preferences")) return undefined;
        return args.preference;
      },
    );
    let controller!: ReturnType<typeof useColumnPreferences>;
    const root = defineComponent({
      setup() {
        controller = useColumnPreferences(tableId, ref(columns), reference, {
          call,
          report: vi.fn(),
          upload: vi.fn(),
        });
        return () => h("div");
      },
    });
    const wrapper = mount(root);
    wrappers.push(wrapper);
    await flushPromises();
    expect(call.mock.calls[0]?.[1]).toEqual({
      table_id: "reports.inventory.summary",
    });
    tableId.value = "reports.movements.records";
    await nextTick();
    await flushPromises();
    expect(call.mock.calls[1]?.[1]).toEqual({
      table_id: "reports.movements.records",
    });
  });

  it("drops a clean cached choice when the account has no saved preference", async () => {
    const reference = createReferenceData();
    Object.assign(reference, { site: "reset-test.local", user: "reset-user" });
    const key =
      "temple-inventory:table-columns:v1:reset-test.local:reset-user:reports.reset-test";
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        values: {
          order: ["item", "quantity", "retired"],
          hidden: ["quantity"],
        },
        dirty: false,
      }),
    );
    const call = vi.fn(async (method: string) =>
      method.endsWith("get_column_preferences") ? undefined : null,
    );
    let controller!: ReturnType<typeof useColumnPreferences>;
    const root = defineComponent({
      setup() {
        controller = useColumnPreferences(
          "reports.reset-test",
          ref(columns),
          reference,
          { call, report: vi.fn(), upload: vi.fn() },
        );
        return () => h("div");
      },
    });
    wrappers.push(mount(root));
    await flushPromises();
    expect(controller.visible.value).toEqual(["item", "quantity", "retired"]);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed local choice visible and offers retry", async () => {
    vi.useFakeTimers();
    const reference = createReferenceData();
    Object.assign(reference, { site: "retry-test.local", user: "retry-user" });
    let fail = true;
    const call = vi.fn(
      async (method: string, args?: Record<string, unknown>) => {
        if (method.endsWith("get_column_preferences")) return undefined;
        if (fail) throw new Error("offline");
        return args?.preference;
      },
    );
    let controller!: ReturnType<typeof useColumnPreferences>;
    const root = defineComponent({
      setup() {
        controller = useColumnPreferences(
          "reports.retry-test",
          ref(columns),
          reference,
          {
            call,
            report: vi.fn(),
            upload: vi.fn(),
          },
        );
        return () =>
          h(DataTable, {
            ariaLabel: "重试表格",
            columns,
            rows: [
              {
                kind: "record",
                id: "item-1",
                value: { item: "纸张", quantity: 3 },
              },
            ],
            columnPreferences: controller,
          });
      },
    });
    const wrapper = mount(root);
    wrappers.push(wrapper);
    await flushPromises();
    await wrapper.get('button[aria-label="设置列"]').trigger("click");
    const quantityInput = document.body.querySelectorAll<HTMLInputElement>(
      '.data-table-column-panel input[type="checkbox"]',
    )[1]!;
    quantityInput.checked = false;
    quantityInput.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("offline");
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "temple-inventory:table-columns:v1:retry-test.local:retry-user:reports.retry-test",
        )!,
      ).dirty,
    ).toBe(true);
    fail = false;
    document.body
      .querySelector<HTMLButtonElement>('[role="alert"] button')
      ?.click();
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(
      wrapper
        .findAll("thead th")
        .filter((cell) => !cell.find('[aria-label="设置列"]').exists())
        .map((cell) => cell.text()),
    ).toEqual(["物品↕", "旧列"]);
  });

  it("mounts report cells with injected account preferences before evaluating columns", async () => {
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "report-test.local",
      user: "report-user",
    });
    const services = {
      call: vi.fn(async <T>(_method: string): Promise<T> => undefined as T),
      report: vi.fn(async () => ({})),
      upload: vi.fn(async () => ({})),
    };
    const root = defineComponent({
      setup() {
        provideInventoryServices(services, reference);
        return () =>
          h(ReportTable, {
            table: {
              id: "activity-metadata",
              label: "活动",
              columns: ["title", "modified"],
              rows: [
                { id: "ACT-1", title: "会议", modified: "2026-10-20 09:00:00" },
              ],
            },
            total: 1,
          });
      },
    });
    const wrapper = mount(root);
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.get("table").text()).toContain("名称");
    expect(wrapper.get("table").text()).toContain("更新时间");
    expect(wrapper.find('button[aria-label="设置列"]').exists()).toBe(true);
  });
});
