import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoanGroupBreakdown from "../src/features/loans/LoanGroupBreakdown.vue";

const RouterLink = defineComponent({
  props: ["to"],
  template: '<a :href="to"><slot /></a>',
});

const makeProps = (name = "ITEM::returned") => ({
  row: {
    name,
    item_code: "ITEM",
    item_name: "相机",
    outcome: "returned",
    outcome_label: "已归还",
    record_count: 1,
    quantity_values: [{ uom: "Nos", qty: 2 }],
  },
  activeName: name,
  records: [
    {
      loan: "LOAN-1",
      detail_route: "/loans/LOAN-1",
      borrower: "借用方",
      loan_date: "2026-10-01",
      activity_title: "义卖活动",
      quantity_values: [{ uom: "Nos", qty: 2 }],
      locations: [
        { warehouse: "A04", batch_no: "B-1", uom: "Nos", quantity: 2 },
      ],
    },
  ],
  total: 1,
  loading: false,
  error: "",
  formatQuantities: (values: any[]) =>
    values.map((value) => `${value.qty} ${value.uom}`).join(" · "),
  warehouseText: (name: string) => name,
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

describe("loan group breakdown interactions", () => {
  it("keeps an open breakdown when the shared breakpoint changes", async () => {
    let change: ((event: MediaQueryListEvent) => void) | undefined;
    let matches = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (
          _: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          change = listener;
        },
        removeEventListener: vi.fn(),
      }),
    });
    const wrapper = mount(LoanGroupBreakdown, {
      props: makeProps(),
      attachTo: document.body,
      global: { stubs: { RouterLink } },
    });
    await wrapper.get("button").trigger("mouseenter");
    await nextTick();
    matches = false;
    change?.({ matches } as MediaQueryListEvent);
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    wrapper.unmount();
  });

  it("opens the same breakdown by click or ArrowDown and closes on Escape", async () => {
    const wrapper = mount(LoanGroupBreakdown, {
      props: makeProps(),
      attachTo: document.body,
      global: { stubs: { RouterLink } },
    });
    const trigger = wrapper.get("button");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect((document.activeElement as HTMLElement).textContent).toContain(
      "LOAN-1",
    );
    await document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("keeps one pinned panel open and dismisses it on an outside pointer", async () => {
    const Host = defineComponent({
      components: { LoanGroupBreakdown },
      props: { propsA: Object, propsB: Object },
      template:
        '<div><LoanGroupBreakdown v-bind="propsA" /><LoanGroupBreakdown v-bind="propsB" /></div>',
    });
    const wrapper = mount(Host, {
      props: { propsA: makeProps("A"), propsB: makeProps("B") },
      attachTo: document.body,
      global: { stubs: { RouterLink } },
    });
    const triggers = wrapper.findAll("button");
    await triggers[0].trigger("click");
    await triggers[1].trigger("click");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    outside.remove();
    wrapper.unmount();
  });

  it("does not unpin on hover or focus after a click", async () => {
    const wrapper = mount(LoanGroupBreakdown, {
      props: makeProps(),
      attachTo: document.body,
      global: { stubs: { RouterLink } },
    });
    const trigger = wrapper.get("button");
    await trigger.trigger("click");
    await trigger.trigger("mouseenter");
    await trigger.trigger("mouseleave");
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    wrapper.unmount();
  });
});
