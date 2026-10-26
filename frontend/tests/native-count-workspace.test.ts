import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import CountWorkspace from "../src/features/counts/CountWorkspace.vue";
import HierarchyFilter from "../src/components/ui/HierarchyFilter.vue";
import type { CountEditor } from "../src/features/counts/useCountEditor";
import type { CountRow } from "../src/features/counts/countModel";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function row(
  index: number,
  warehouse = index < 3 ? "ROOM-A" : "ROOM-B",
): CountRow {
  return {
    item_code: `ITEM-${String(index).padStart(3, "0")}`,
    item_name: `物品${index}`,
    image: "",
    warehouse,
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: 4,
    actual_qty: null,
    review_state: "Unreviewed",
    reason: "",
    needs_review: false,
  };
}

function setup(
  rows = Array.from({ length: 105 }, (_, index) => row(index)),
  mobile = false,
) {
  vi.stubGlobal("matchMedia", () => ({
    matches: !mobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    physicalLeaves: ["ROOM-A", "ROOM-B"],
    warehouses: [
      {
        name: "ROOT",
        label: "库位",
        parent: "",
        is_group: true,
        lft: 1,
        rgt: 10,
      },
      {
        name: "PHYSICAL",
        label: "实体位置",
        parent: "ROOT",
        is_group: true,
        lft: 2,
        rgt: 7,
      },
      {
        name: "ROOM-A",
        label: "甲室",
        parent: "PHYSICAL",
        is_group: false,
        lft: 3,
        rgt: 4,
      },
      {
        name: "ROOM-B",
        label: "乙室",
        parent: "PHYSICAL",
        is_group: false,
        lft: 5,
        rgt: 6,
      },
      {
        name: "LOAN",
        label: "借出区",
        parent: "ROOT",
        is_group: false,
        lft: 8,
        rgt: 9,
      },
    ],
    units: [{ name: "Nos", whole: true }],
  });
  const controller = {
    values: ref({
      ti_count_warehouses: ["ROOM-A", "ROOM-B"],
      ti_count_scope: "Full Location",
    }),
    rows: ref(rows),
    names: reactive<Record<string, string>>({}),
    images: reactive<Record<string, string>>({}),
    reference,
    writable: ref(true),
    busy: ref(false),
    baselineBusy: ref(false),
    baselineError: ref(""),
    issues: ref([]),
    showError: ref(false),
    removed: ref([]),
    removalAcknowledged: ref(true),
    historyTarget: ref<CountRow>(),
    history: {
      sortBy: ref("date"),
      sortDirection: ref<"asc" | "desc">("desc"),
      result: reactive({
        rows: [],
        total: 0,
        next: null,
        loading: false,
        error: "",
        initialized: false,
        stale: false,
      }),
      loadMore: vi.fn(),
      retry: vi.fn(),
    },
    countKey: (value: CountRow) =>
      JSON.stringify([value.item_code, value.warehouse, value.batch_no || ""]),
    input: (value: CountRow, input: string) => {
      value.actual_qty = input === "" ? null : Number(input);
      value.review_state = input === "" ? "Unreviewed" : "Reviewed";
      value.needs_review = false;
    },
    clearInput: (value: CountRow) => {
      value.actual_qty = null;
      value.review_state = "Unreviewed";
      value.reason = "";
    },
    rereview: (value: CountRow) => {
      value.needs_review = false;
      value.review_state =
        value.actual_qty === null ? "Unreviewed" : "Reviewed";
    },
    openHistory: (value: CountRow) => (controller.historyTarget.value = value),
    closeHistory: () => (controller.historyTarget.value = undefined),
    chooseItems: vi.fn(),
  };
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () =>
        h("form", [
          h(CountWorkspace, {
            controller: controller as unknown as CountEditor,
          }),
        ]);
    },
  });
  const wrapper = mount(root, { attachTo: document.body });
  wrappers.push(wrapper);
  return { wrapper, controller, reference };
}

describe("compact count workspace", () => {
  it("shows phone count cards with blank-versus-zero input and live differences", async () => {
    const { wrapper, controller } = setup(
      [row(0, "ROOM-A"), row(1, "ROOM-B")],
      true,
    );
    await flushPromises();
    expect(wrapper.findAll(".count-card")).toHaveLength(2);
    expect(wrapper.find(".count-data-table").exists()).toBe(false);
    const inputs = wrapper.findAll<HTMLInputElement>(".count-card-input");
    expect(inputs[0]!.element.type).toBe("number");
    expect(inputs[0]!.attributes("inputmode")).toBe("decimal");
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("");

    await inputs[0]!.setValue("0");
    expect(controller.rows.value[0]?.actual_qty).toBe(0);
    expect(controller.rows.value[0]?.review_state).toBe("Reviewed");
    expect(wrapper.findAll(".count-card-difference")[0]?.text()).toBe(
      "差异 -4",
    );
    await inputs[0]!.setValue("");
    expect(controller.rows.value[0]?.actual_qty).toBeNull();
    expect(controller.rows.value[0]?.review_state).toBe("Unreviewed");
  });

  it("keeps desktop counts in DataTable and pages phone cards at 100 rows", async () => {
    const desktop = setup();
    await flushPromises();
    expect(desktop.wrapper.find(".count-data-table").exists()).toBe(true);
    expect(desktop.wrapper.findAll(".count-card")).toHaveLength(0);
    desktop.wrapper.unmount();

    const phone = setup(
      Array.from({ length: 105 }, (_, index) => row(index)),
      true,
    );
    await flushPromises();
    expect(phone.wrapper.findAll(".count-card")).toHaveLength(100);
    await phone.wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页")!
      .trigger("click");
    expect(phone.wrapper.findAll(".count-card")).toHaveLength(5);
  });

  it("renders phone count cards as read-only when the count is not writable", async () => {
    const { wrapper, controller } = setup([row(0, "ROOM-A")], true);
    controller.writable.value = false;
    await flushPromises();
    expect(wrapper.findAll(".count-card-input")).toHaveLength(0);
    expect(wrapper.find(".count-card-entry").text()).toContain("未核对");
  });

  it("moves Enter to the next phone count input without submitting the form", async () => {
    const { wrapper } = setup([row(0, "ROOM-A"), row(1, "ROOM-B")], true);
    await flushPromises();
    const inputs = wrapper.findAll<HTMLInputElement>(".count-card-input");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    inputs[0]!.element.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(inputs[1]!.element);
  });

  it("retains entered quantities across search and location filters and clamps pagination", async () => {
    const { wrapper, controller } = setup();
    await flushPromises();
    const next = wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页")!;
    await next.trigger("click");
    expect(wrapper.findAll("tbody tr[data-count-key]")).toHaveLength(5);
    controller.rows.value[0]!.actual_qty = 0;
    controller.rows.value[0]!.review_state = "Reviewed";
    await wrapper.find("input[type=search]").setValue("物品0");
    expect(wrapper.findAll("tbody tr[data-count-key]").length).toBeGreaterThan(
      0,
    );
    expect(controller.rows.value[0]?.actual_qty).toBe(0);
    await wrapper.find("input[type=search]").setValue("");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页")!
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("位置"))!
      .trigger("click");
    expect(
      wrapper.findComponent(HierarchyFilter).props("initialExpansion"),
    ).toBe("branching-leaves");
    await flushPromises();
    const filter = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="显示位置"]',
    );
    expect(filter).not.toBeNull();
    filter!.value = "甲室";
    filter!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    const tree = document.body.querySelector<HTMLElement>(
      ".preview-filter-popover",
    )!;
    expect(tree.textContent).not.toContain("借出区");
    const room = Array.from(
      tree.querySelectorAll<HTMLLabelElement>(".hierarchy-list label"),
    ).find((label) => label.textContent?.includes("甲室"));
    expect(room).toBeTruthy();
    await room!.querySelector("input")!.click();
    await flushPromises();
    expect(wrapper.findAll("tbody tr[data-count-key]")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("2 / 1");
    expect(controller.rows.value).toHaveLength(105);
    expect(controller.rows.value[0]?.actual_qty).toBe(0);
  });

  it("shows a changed-baseline acknowledgement, resets row inputs, and keeps controls from submitting the form", async () => {
    const changed = row(0, "ROOM-A");
    changed.baseline_qty = 7;
    changed.actual_qty = 3;
    changed.review_state = "Unreviewed";
    changed.needs_review = true;
    const { wrapper, controller } = setup([changed]);
    await flushPromises();
    expect(wrapper.text()).toContain("基准已变化");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "确认仍按当前实点")!
      .trigger("click");
    expect(changed.needs_review).toBe(false);
    expect(changed.review_state).toBe("Reviewed");
    const sortButton = wrapper.find(".count-table th button");
    expect((sortButton.element as HTMLButtonElement).type).toBe("button");
    for (const button of wrapper.findAll(".count-review-tabs button"))
      expect((button.element as HTMLButtonElement).type).toBe("button");
    expect(wrapper.text()).not.toContain("保存草稿");
    expect(wrapper.text()).not.toContain("核对并确认");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "清除输入")!
      .trigger("click");
    expect(changed.actual_qty).toBeNull();
    expect(changed.review_state).toBe("Unreviewed");
    expect(controller.rows.value).toHaveLength(1);
  });

  it("does not mark a fresh blank baseline row as changed", async () => {
    const fresh = row(0, "ROOM-A");
    fresh.needs_review = true;
    fresh.actual_qty = null;
    const { wrapper } = setup([fresh]);
    await flushPromises();
    expect(wrapper.text()).not.toContain("基准已变化");
    expect(wrapper.text()).not.toContain("确认仍按当前实点");
  });

  it("clamps the page when a refreshed baseline removes later rows", async () => {
    const { wrapper, controller } = setup();
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页")!
      .trigger("click");
    expect(wrapper.findAll("tbody tr[data-count-key]")).toHaveLength(5);
    controller.rows.value.splice(5);
    await flushPromises();
    expect(wrapper.findAll("tbody tr[data-count-key]")).toHaveLength(5);
    expect(wrapper.text()).not.toContain("2 / 1");
  });

  it("keeps serialized unreviewed zeros blank and counts only real hidden inputs", async () => {
    const visibleZero = row(0, "ROOM-A");
    visibleZero.actual_qty = 0;
    visibleZero.review_state = "Reviewed";
    const hiddenCount = row(1, "ROOM-B");
    hiddenCount.actual_qty = 3;
    hiddenCount.review_state = "Reviewed";
    const serializedBlank = row(2, "ROOM-B");
    serializedBlank.actual_qty = 0;
    const { wrapper, controller } = setup([
      visibleZero,
      hiddenCount,
      serializedBlank,
    ]);
    await flushPromises();

    expect(
      wrapper
        .findAll(".count-actual-input")
        .map((input) => (input.element as HTMLInputElement).value),
    ).toEqual(["0", "3", ""]);
    expect(
      wrapper.findAll("tbody tr[data-count-key]")[2]?.findAll("td")[8]?.text(),
    ).toBe("待核对");

    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("位置"))!
      .trigger("click");
    await flushPromises();
    const filter = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="显示位置"]',
    )!;
    filter.value = "甲室";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    const room = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>(".hierarchy-list label"),
    ).find((label) => label.textContent?.includes("甲室"))!;
    await room.querySelector("input")!.click();
    await flushPromises();
    expect(wrapper.text()).toContain("已隐藏 1 条有输入的记录");

    const retained = row(3, "ROOM-B");
    retained.actual_qty = 2;
    retained.needs_review = true;
    controller.rows.value.push(retained);
    await flushPromises();
    expect(wrapper.text()).toContain("已隐藏 2 条有输入的记录");
  });

  it("renders submitted history quantities and emits guarded native navigation intent", async () => {
    const current = row(0, "ROOM-A");
    const { wrapper, controller } = setup([current]);
    await flushPromises();
    controller.openHistory(current);
    Object.assign(controller.history.result, {
      rows: [
        {
          id: "Stock Entry|ISSUE-1|ITEM-000|ROOM-A",
          doctype: "Stock Entry",
          document: "ISSUE-1",
          item_code: current.item_code,
          item_name: current.item_name,
          date_time: "2026-10-19 10:00:00",
          kind: "Issue",
          source_warehouse: "ROOM-A",
          destination_warehouse: "",
          stock_uom: "Nos",
          docstatus: 1,
          quantity: -2,
          available_effect: -2,
          loan_balance_effect: 0,
          borrower: "",
        },
      ],
      total: 1,
      initialized: true,
    });
    await flushPromises();
    expect(document.body.textContent).toContain("−2");
    expect(document.body.textContent).toContain("库存单位");
    const historyDocument = document.body.querySelector<HTMLButtonElement>(
      'button[title="ISSUE-1"]',
    );
    expect(historyDocument).toBeTruthy();
    historyDocument!.click();
    await flushPromises();
    expect(
      wrapper.getComponent(CountWorkspace).emitted("openDocument"),
    ).toEqual([["Stock Entry", "ISSUE-1"]]);
  });

  it("routes loan history records through the guarded Stock Entry navigation", async () => {
    const current = row(0, "ROOM-A");
    const { wrapper, controller } = setup([current]);
    controller.openHistory(current);
    Object.assign(controller.history.result, {
      rows: [
        {
          id: "Stock Entry|LOAN-1|ITEM-000|ROOM-A",
          doctype: "Stock Entry",
          document: "LOAN-1",
          item_code: current.item_code,
          item_name: current.item_name,
          date_time: "2026-10-19 10:00:00",
          kind: "Loan",
          source_warehouse: "ROOM-A",
          destination_warehouse: "",
          stock_uom: "Nos",
          docstatus: 1,
          quantity: -1,
          available_effect: -1,
          loan_balance_effect: 1,
          borrower: "借用人",
        },
      ],
      total: 1,
      initialized: true,
    });
    await flushPromises();
    const record = document.body.querySelector<HTMLButtonElement>(
      'button[title="LOAN-1"]',
    )!;
    record.click();
    await flushPromises();
    expect(
      wrapper.getComponent(CountWorkspace).emitted("openDocument"),
    ).toEqual([["Stock Entry", "LOAN-1"]]);
  });
});
