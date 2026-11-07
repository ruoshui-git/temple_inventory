// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import AsOfFilter from "../src/components/ui/AsOfFilter.vue";
import QuickExport from "../src/components/QuickExport.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import { browseDefaults } from "../src/lib/browseDefaults";
import {
  decodeReportQuery,
  normalizeReportQuery,
} from "../src/lib/reportQuery";
import { reportFilterChips } from "../src/lib/reportFilters";
import { serializeBrowseQuery } from "../src/lib/routeRegistry";
import { useStockBrowseController } from "../src/features/inventory/useStockBrowseController";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const historical = (asOf: string) => ({ ...newReportQuery("inventory"), asOf });

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll("button").find((row) => row.text() === label);
  if (!found) throw new Error(`missing button ${label}`);
  return found;
}

describe("AsOfFilter staged editing", () => {
  it("stages date and time until 应用 and caps the date at the site day", async () => {
    const wrapper = mount(AsOfFilter, {
      props: { modelValue: "", today: "2026-11-02" },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("当前显示：现在");
    const date = wrapper.get('input[type="date"]');
    expect(date.attributes("max")).toBe("2026-11-02");
    expect(wrapper.get('input[type="time"]').attributes("step")).toBe("1");

    await date.setValue("2026-10-31");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("update:modelValue")).toEqual([["2026-10-31"]]);

    await wrapper.setProps({ modelValue: "2026-10-31" });
    await wrapper.get('input[type="time"]').setValue("18:00:00");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      "2026-10-31 18:00:00",
    ]);
  });

  it("rejects a future date or a missing date without emitting", async () => {
    const wrapper = mount(AsOfFilter, {
      props: { modelValue: "", today: "2026-11-02" },
    });
    wrappers.push(wrapper);
    await wrapper.get('input[type="date"]').setValue("2026-11-03");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("不能晚于今天");
    await wrapper.get('input[type="date"]').setValue("");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("请选择截至日期");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("撤销 restores the applied moment and 现在 clears it at once", async () => {
    const wrapper = mount(AsOfFilter, {
      props: { modelValue: "2026-10-31", today: "2026-10-16" },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("当前显示：2026-10-31");
    await wrapper.get('input[type="date"]').setValue("2026-10-01");
    await button(wrapper, "撤销").trigger("click");
    expect(
      (wrapper.get('input[type="date"]').element as HTMLInputElement).value,
    ).toBe("2026-10-31");
    await button(wrapper, "现在").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });
});

describe("as-of query contract", () => {
  it("shows a fixed 截至：现在 chip by default and the moment once it is set", () => {
    const reference = createReferenceData();
    const now = reportFilterChips(newReportQuery("inventory"), reference).find(
      (chip) => chip.key === "asOf",
    );
    expect(now).toMatchObject({
      label: "截至：现在",
      reset: { asOf: "" },
      fixed: true,
    });
    const past = reportFilterChips(
      historical("2026-10-31 18:00:00"),
      reference,
    ).find((chip) => chip.key === "asOf");
    expect(past).toMatchObject({
      label: "截至：2026-10-31 18:00:00",
      reset: { asOf: "" },
      fixed: false,
    });
  });

  it("is offered only on the stock summary and location views", () => {
    const reference = createReferenceData();
    const keys = (query: ReturnType<typeof newReportQuery>) =>
      reportFilterChips(query, reference).map((chip) => chip.key);
    expect(keys(newReportQuery("movements"))).not.toContain("asOf");
    expect(keys(newReportQuery("expiry"))).not.toContain("asOf");
    const historicalView = newReportQuery("inventory");
    historicalView.view = "historical";
    expect(keys(historicalView)).not.toContain("asOf");
  });

  it("round trips through the report payload and clears where it is unsupported", () => {
    const query = { ...historical("2026-10-31"), view: "locations" };
    expect(decodeReportQuery(query)).toMatchObject({
      error: "",
      query: { asOf: "2026-10-31" },
    });
    expect(
      decodeReportQuery({ dataset: "movements", asOf: "2026-10-31" }).query
        .asOf,
    ).toBe("");
    expect(
      decodeReportQuery({
        dataset: "inventory",
        view: "historical",
        asOf: "2026-10-31",
      }).query.asOf,
    ).toBe("");
    expect(
      normalizeReportQuery({ ...newReportQuery("expiry"), asOf: "2026-10-31" })
        .asOf,
    ).toBe("");
    expect(normalizeReportQuery(query).asOf).toBe("2026-10-31");
  });

  it("keeps the URL to the non-default moment only", () => {
    const page = browseDefaults("inventory", "summary");
    expect(serializeBrowseQuery(page)).toBeUndefined();
    expect(
      JSON.parse(serializeBrowseQuery({ ...page, asOf: "2026-10-31" }) ?? "{}"),
    ).toMatchObject({ asOf: "2026-10-31" });
  });
});

describe("stock page as-of reading", () => {
  function services(): InventoryServices {
    return {
      call: vi.fn(async () => ({
        rows: [],
        matched_count: 0,
        next_start: null,
        summary: [],
        snapshot: "2026-11-02 09:00",
        query: newReportQuery("inventory"),
        analysis: { category: [], location: [] },
      })),
      report: vi.fn(),
      upload: vi.fn(),
    } as unknown as InventoryServices;
  }
  function setup(service: InventoryServices, navigate = vi.fn()) {
    const reference = createReferenceData();
    reference.siteDate = "2026-11-02";
    reference.user = "Administrator";
    reference.operations = { Receive: true, Issue: true, Transfer: true };
    reference.capabilities.stock_entry.create = true;
    reference.capabilities.item.create = true;
    let result!: ReturnType<typeof useStockBrowseController>;
    const child = defineComponent({
      setup() {
        result = useStockBrowseController(reactive({}), navigate, vi.fn());
        return () => h("div");
      },
    });
    const root = defineComponent({
      setup() {
        provideInventoryServices(service, reference);
        return () => h(child);
      },
    });
    wrappers.push(mount(root));
    return result;
  }

  it("sends the moment to the server and withdraws movement actions while reading history", async () => {
    const service = services();
    const navigate = vi.fn();
    const controller = setup(service, navigate);
    await flushPromises();
    controller.toggle("A");
    expect(controller.asOfActive.value).toBe(false);
    expect(
      controller.selectedActions.value.map((action) => action.kind),
    ).toContain("Issue");
    expect(controller.actions.value.map((action) => action.kind)).toContain(
      "Receive",
    );

    controller.setAsOf("2026-10-31 18:00:00");
    await flushPromises();
    expect(controller.asOfActive.value).toBe(true);
    expect(vi.mocked(service.call).mock.calls.at(-1)?.[1]).toMatchObject({
      query: expect.objectContaining({ asOf: "2026-10-31 18:00:00" }),
    });
    expect(controller.selectedActions.value).toEqual([]);
    expect(controller.actions.value.map((action) => action.kind)).toEqual([
      "Item",
    ]);
    controller.selectedAction("Issue");
    controller.rowAction("Issue", { code: "A" } as never);
    expect(navigate).not.toHaveBeenCalled();

    controller.setAsOf("");
    await flushPromises();
    expect(controller.asOfActive.value).toBe(false);
    expect(controller.query.value.asOf).toBe("");
  });

  it("names the moment in the export dialog's filter list", async () => {
    const service = services();
    const child = defineComponent({
      setup() {
        provideInventoryServices(service, createReferenceData());
        return () =>
          h(QuickExport, {
            query: historical("2026-10-31"),
            title: "库存列表",
            table: "locations",
            columns: ["item_code", "stock_qty"],
          });
      },
    });
    const wrapper = mount(child);
    wrappers.push(wrapper);
    await wrapper.get(".quick-report").trigger("click");
    await flushPromises();
    const dialog = document.body.querySelector(".quick-export-dialog")!;
    expect(dialog.textContent).toContain("截至：2026-10-31");
  });
});
