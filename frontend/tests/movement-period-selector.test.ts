import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import MovementPeriodSelector from "../src/components/MovementPeriodSelector.vue";

describe("movement period selector", () => {
  it("renders a compact trigger with resolved range and all period choices", async () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: {
        periodKey: "last_30_days",
        resolvedFrom: "2026-09-09",
        resolvedTo: "2026-10-08",
        variant: "ledger",
        compact: true,
      },
    });
    expect(wrapper.find(".period-compact").text()).toContain("近30天");
    expect(wrapper.find(".period-compact-resolved").text()).toContain(
      "2026-09-09",
    );
    await wrapper.find(".period-more-trigger").trigger("click");
    await nextTick();
    const menu = document.body.querySelector("[role=menu]");
    expect(menu?.textContent).toContain("近7天");
    expect(menu?.textContent).toContain("本月");
    expect(menu?.textContent).toContain("全部时间");
    expect(menu?.textContent).toContain("自定义");
    wrapper.unmount();
  });
  it("keeps a rolling period as an active dropdown and switches rolling values", async () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: { periodKey: "last_30_days", variant: "ledger" },
    });
    expect(wrapper.find(".period-more-trigger").text()).toContain("近30天");
    expect(
      wrapper.find(".period-more-trigger").attributes("aria-pressed"),
    ).toBe("true");
    await wrapper.find(".period-more-trigger").trigger("click");
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    await menu.querySelectorAll("button")[3].click();
    expect(wrapper.emitted("update:periodKey")?.at(-1)).toEqual([
      "last_365_days",
    ]);
  });

  it("keeps custom dates in an anchored popover without expanding the header", async () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: {
        periodKey: "custom",
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        resolvedFrom: "2026-09-01",
        resolvedTo: "2026-09-30",
        variant: "ledger",
      },
    });
    expect(wrapper.find(".period-choices").exists()).toBe(true);
    expect(wrapper.find(".custom-period").exists()).toBe(false);
    expect(wrapper.find(".custom-period-trigger").text()).toContain(
      "2026-09-01 至 2026-09-30",
    );
    await wrapper.find(".custom-period-trigger").trigger("click");
    await nextTick();
    const menu = document.body.querySelector(
      '[role="dialog"][aria-label="自定义日期"]',
    ) as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.getAttribute("role")).toBe("dialog");
    expect(menu.querySelectorAll('input[type="date"]')).toHaveLength(2);
    expect(
      wrapper.find(".movement-period-ledger > .custom-period").exists(),
    ).toBe(false);
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(
      document.body.querySelector('[role="dialog"][aria-label="自定义日期"]'),
    ).toBeNull();
    await wrapper.find(".period-choices button").trigger("click");
    expect(wrapper.emitted("update:periodKey")?.at(-1)).toEqual(["this_week"]);
  });
  it("closes the out-of-flow More menu on selection, outside click, and Escape", async () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: {
        periodKey: "this_month",
        resolvedFrom: "2026-09-01",
        resolvedTo: "2026-09-30",
        variant: "ledger",
      },
      attachTo: document.body,
    });
    const more = wrapper.find(".period-more-trigger");
    await more.trigger("click");
    expect(more.attributes("aria-expanded")).toBe("true");
    expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1);
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(more.attributes("aria-controls")).toBe(menu.id);
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4);
    expect(more.element.querySelector('[role="menu"]')).toBeNull();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(more.attributes("aria-expanded")).toBe("false");
    await more.trigger("click");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(more.attributes("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    await more.trigger("click");
    const selectedMenu = document.body.querySelector(
      '[role="menu"]',
    ) as HTMLElement;
    await selectedMenu
      .querySelector('[role="menuitemradio"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:periodKey")).toBeTruthy();
    expect(more.attributes("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(more.element);
  });
  it("shows exactly one resolved range for ledger controls", () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: {
        periodKey: "this_month",
        resolvedFrom: "2026-09-01",
        resolvedTo: "2026-09-30",
        variant: "ledger",
      },
    });
    expect(wrapper.findAll(".resolved-period")).toHaveLength(1);
    expect(wrapper.text().match(/2026-09-01 至 2026-09-30/g)).toHaveLength(1);
  });

  it("exposes an all-time choice with an unrestricted resolved range", async () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: {
        periodKey: "all",
        resolvedFrom: "",
        resolvedTo: "",
        variant: "ledger",
      },
    });
    expect(wrapper.find(".period-choices").text()).toContain("全部时间");
    expect(wrapper.find(".resolved-period").text()).toBe("全部时间");
    await wrapper.findAll(".period-choices button")[0].trigger("click");
    expect(wrapper.emitted("update:periodKey")?.at(-1)).toEqual(["this_week"]);
  });

  it("uses unique ids for teleported period menus across instances", async () => {
    const Host = defineComponent({
      components: { MovementPeriodSelector },
      template: `<div>
        <MovementPeriodSelector period-key="this_month" variant="ledger" />
        <MovementPeriodSelector period-key="this_month" variant="ledger" />
      </div>`,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const triggers = wrapper.findAll(".period-more-trigger");
    const controls = triggers.map((trigger) =>
      trigger.attributes("aria-controls"),
    );
    expect(new Set(controls).size).toBe(2);
    await triggers[0].trigger("click");
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.id).toBe(controls[0]);
    wrapper.unmount();
  });

  it("uses unique controls for custom date dialogs across instances", async () => {
    const Host = defineComponent({
      components: { MovementPeriodSelector },
      template: `<div>
        <MovementPeriodSelector period-key="custom" date-from="2026-03-01" date-to="2026-03-02" resolved-from="2026-03-01" resolved-to="2026-03-02" variant="ledger" />
        <MovementPeriodSelector period-key="custom" date-from="2026-03-01" date-to="2026-03-02" resolved-from="2026-03-01" resolved-to="2026-03-02" variant="ledger" />
      </div>`,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const triggers = wrapper.findAll(".custom-period-trigger");
    const controls = triggers.map((trigger) =>
      trigger.attributes("aria-controls"),
    );
    expect(new Set(controls).size).toBe(2);
    await triggers[0].trigger("click");
    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="自定义日期"]',
    ) as HTMLElement;
    expect(dialog.id).toBe(controls[0]);
    wrapper.unmount();
  });
});
