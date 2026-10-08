import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ColumnSummaryDialog from "../src/components/ColumnSummaryDialog.vue";

describe("ColumnSummaryDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  });

  const columns = [
    { key: "quantity", label: "数量", summary: "quantity" },
    { key: "records", label: "记录数", summary: "records" },
  ];
  const summaries = {
    quantity: {
      type: "quantity" as const,
      unitless_total: 7,
      by_uom: [
        { uom: "Nos", qty: 4 },
        { uom: "箱", qty: 3 },
      ],
    },
    records: { type: "number" as const, value: 2 },
  };

  it("renders UOM breakdown and restores focus/overflow on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开";
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(ColumnSummaryDialog, {
      props: { open: true, columns, summaries },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    expect(document.body.textContent).toContain("Nos");
    expect(document.body.textContent).toContain("箱");
    expect(document.documentElement.style.overflow).toBe("hidden");
    const backdrop = document.body.querySelector(
      ".column-summary-backdrop",
    ) as HTMLElement;
    expect(backdrop).not.toBeNull();
    backdrop.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    await wrapper.setProps({ open: false });
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
    trigger.remove();
  });

  it("traps tab focus and announces summary refresh", async () => {
    const wrapper = mount(ColumnSummaryDialog, {
      props: { open: true, columns, summaries, loading: true },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    const status = document.body.querySelector('[role="status"]');
    expect(status?.textContent).toContain("更新汇总");
    const close = document.body.querySelector(
      ".column-summary-dialog header button",
    ) as HTMLButtonElement;
    expect(close).not.toBeNull();
    close.focus();
    const dialog = document.body.querySelector(
      ".column-summary-dialog",
    ) as HTMLElement;
    expect(dialog).not.toBeNull();
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    expect(document.activeElement).not.toBe(document.body);
    wrapper.unmount();
  });
});
