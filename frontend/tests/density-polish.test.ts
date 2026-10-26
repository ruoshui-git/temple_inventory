// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import BrowseSplitButton from "../src/components/ui/BrowseSplitButton.vue";
import BrowseResultSummary from "../src/components/ui/BrowseResultSummary.vue";
import DataTable from "../src/components/ui/DataTable.vue";
import RecordRef from "../src/components/ui/RecordRef.vue";
import { compactGroupSummary } from "../src/lib/groupSummary";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

it("opens the split-button creation menu and emits the selected permitted kind", async () => {
  const wrapper = mount(BrowseSplitButton, {
    props: {
      label: "入库",
      kind: "Receive",
      icon: "receive",
      options: [{ label: "出库", kind: "Issue", icon: "issue" }],
    },
  });
  wrappers.push(wrapper);
  document
    .querySelector<HTMLButtonElement>('[aria-label="选择新建类型"]')!
    .click();
  await Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.includes("出库"))!
    .click();
  expect(wrapper.emitted("select")).toEqual([["Issue"]]);
  await flushPromises();
  expect(
    document
      .querySelector('[aria-label="选择新建类型"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("false");
});

it("fires the default action from the mobile FAB and hides it while an overlay is open", async () => {
  const wrapper = mount(BrowseSplitButton, {
    attachTo: document.body,
    props: { label: "入库", kind: "Receive", icon: "receive", options: [] },
  });
  wrappers.push(wrapper);
  document
    .querySelector<HTMLButtonElement>(".browse-split-button > .ui-button")!
    .click();
  expect(wrapper.emitted("select")).toEqual([["Receive"]]);
  const overlay = document.createElement("div");
  overlay.className = "preview-overlay";
  document.body.append(overlay);
  await vi.waitFor(() =>
    expect(
      document
        .querySelector(".browse-split-button")
        ?.classList.contains("is-hidden"),
    ).toBe(true),
  );
  expect(
    document
      .querySelector(".browse-split-button")
      ?.classList.contains("is-hidden"),
  ).toBe(true);
  overlay.remove();
});

it("merges result count with a short multi-unit preview and discloses full quantities", async () => {
  const wrapper = mount(BrowseResultSummary, {
    props: {
      label: "163 种物品",
      metrics: [
        {
          key: "in",
          label: "入库",
          quantities: [
            { qty: 12.5, uom: "Kg" },
            { qty: 2, uom: "箱" },
          ],
        },
        { key: "out", label: "出库", quantities: [{ qty: 31, uom: "Nos" }] },
      ],
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  expect(wrapper.get(".browse-result-summary-label").text()).toContain(
    "163 种物品",
  );
  expect(wrapper.get(".browse-result-summary-trigger").text()).toContain(
    "入库 12.5 Kg",
  );
  expect(wrapper.get(".browse-result-summary-trigger").text()).toContain(
    "+1 单位",
  );
  await wrapper.get(".browse-result-summary-trigger").trigger("click");
  expect(wrapper.get(".quantity-summary").text()).toContain("31 Nos");
});

it("keeps two group values inline and represents the remainder with +N 项", () => {
  expect(
    compactGroupSummary("入库 9 Kg · 出库 7 Kg · 调拨 3 箱 · 借出 1 Nos"),
  ).toBe("入库\u00a09\u00a0Kg · 出库\u00a07\u00a0Kg · +2\u00a0项");
});

it("shows an icon and a primary action for an empty results table", async () => {
  const wrapper = mount(DataTable, {
    props: {
      ariaLabel: "库存",
      columns: [],
      rows: [],
      initialized: true,
      emptyAction: "显示全部物品",
    },
  });
  wrappers.push(wrapper);
  expect(wrapper.get(".data-table-state svg").exists()).toBe(true);
  await wrapper.get(".data-table-state button").trigger("click");
  expect(wrapper.emitted("emptyAction")).toHaveLength(1);
});

it("keeps a document name in the RecordRef tooltip without widening the chip", () => {
  const wrapper = mount(RecordRef, {
    props: {
      kind: "Loan",
      identity: "活动服务团队 · 10-02",
      documentName: "MAT-STE-2026-01568-1",
    },
  });
  wrappers.push(wrapper);
  expect(wrapper.get(".record-ref-chip").attributes("title")).toContain(
    "MAT-STE-2026-01568-1",
  );
  expect(wrapper.get(".record-ref-main").text()).not.toContain(
    "MAT-STE-2026-01568-1",
  );
});
