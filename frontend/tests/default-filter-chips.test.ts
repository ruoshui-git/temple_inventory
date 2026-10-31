// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PeriodFilter from "../src/components/ui/PeriodFilter.vue";
import { createReferenceData } from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import {
  clearReportSecondaryFilters,
  reportFilterChips,
} from "../src/lib/reportFilters";
import {
  browseDefaults,
  filtersAtDefaults,
  linkedConstraintFields,
} from "../src/lib/browseDefaults";
import {
  clearScopeField,
  scopeFilterFieldChips,
} from "../src/lib/filterPresentation";
import {
  configurePreferenceSave,
  defaultPeriods,
  hydrateUiPreferences,
} from "../src/lib/uiPreferences";
import { defaultDisplayPreferences } from "../src/lib/displayPreferences";

const reference = createReferenceData();
const wrappers: VueWrapper[] = [];

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe("page default restrictions show as chips that lift to unrestricted values", () => {
  it("shows the inventory defaults 库存状态：有库存 and 物品状态：启用", () => {
    const chips = reportFilterChips(newReportQuery("inventory"), reference);
    expect(chips).toContainEqual(
      expect.objectContaining({
        key: "stockState",
        label: "库存状态：有库存",
        reset: { stockState: "all" },
      }),
    );
    expect(chips).toContainEqual(
      expect.objectContaining({
        key: "itemStatus",
        label: "物品状态：启用",
        reset: { itemStatus: "all" },
      }),
    );
  });

  it("shows no chip for filters that are already unrestricted", () => {
    const query = newReportQuery("inventory");
    query.stockState = "all";
    query.itemStatus = "all";
    const keys = reportFilterChips(query, reference).map((chip) => chip.key);
    expect(keys).not.toContain("stockState");
    expect(keys).not.toContain("itemStatus");
  });

  it("shows the default outstanding-loans status, lifting to 全部", () => {
    const query = newReportQuery("loans");
    query.view = "records";
    expect(reportFilterChips(query, reference)).toContainEqual(
      expect.objectContaining({
        key: "loanStatus",
        label: "借用状态：未结清",
        reset: { loanStatus: "all" },
      }),
    );
  });

  it("shows the default submitted-only movement status and lifts it to all three statuses", () => {
    const query = browseDefaults("movements", "records");
    expect(reportFilterChips(query, reference)).toContainEqual(
      expect.objectContaining({
        key: "statuses",
        label: "单据状态：已提交",
        reset: { statuses: [0, 1, 2] },
      }),
    );
  });

  it("shows the date chip for the account default range and nothing for 全部时间", () => {
    const scope = browseDefaults("movements", "records").scope;
    expect(scopeFilterFieldChips(scope, reference)).toContainEqual(
      expect.objectContaining({
        field: "period",
        label: expect.stringContaining("本月"),
      }),
    );
    scope.period = { key: "all", from: "", to: "" };
    expect(
      scopeFilterFieldChips(scope, reference).some(
        (chip) => chip.field === "period",
      ),
    ).toBe(false);
  });

  it("lifts a date chip to 全部时间, not to the account default", () => {
    const scope = browseDefaults("movements", "records").scope;
    clearScopeField(scope, "period");
    expect(scope.period).toEqual({ key: "all", from: "", to: "" });
  });
});

describe("counts records statuses", () => {
  it("default to 全部状态 without a chip, and a narrowed status chip lifts back to all three", () => {
    const defaults = browseDefaults("counts", "records", "browse");
    expect(defaults.statuses).toEqual([0, 1, 2]);
    const query = browseDefaults("counts", "records", "browse");
    expect(
      reportFilterChips(query, reference).some(
        (chip) => chip.key === "statuses",
      ),
    ).toBe(false);
    query.statuses = [1];
    expect(reportFilterChips(query, reference)).toContainEqual(
      expect.objectContaining({
        key: "statuses",
        label: "单据状态：已提交",
        reset: { statuses: [0, 1, 2] },
      }),
    );
  });

  it("are restored to the page default by 恢复默认 (not to the old submitted-only value)", () => {
    const defaults = browseDefaults("counts", "records", "browse");
    const query = browseDefaults("counts", "records", "browse");
    query.statuses = [1];
    query.person = { name: "张三", role: "handler" };
    query.loan = "LOAN-1";
    clearReportSecondaryFilters(query, defaults);
    expect(query.statuses).toEqual([0, 1, 2]);
    expect(query.person).toEqual({ name: "", role: "any" });
    expect(query.loan).toBe("");
  });
});

describe("恢复默认 visibility", () => {
  it("is hidden when every filter equals the page default, ignoring search and sort", () => {
    const defaults = browseDefaults("inventory", "summary");
    const query = browseDefaults("inventory", "summary");
    expect(filtersAtDefaults(query, defaults)).toBe(true);
    query.search = "螺丝";
    query.sortBy = "item_code";
    query.sort = "desc";
    expect(filtersAtDefaults(query, defaults)).toBe(true);
    query.stockState = "all";
    expect(filtersAtDefaults(query, defaults)).toBe(false);
  });

  it("ignores link-provided constraints when the panel reset keeps them", () => {
    const defaults = browseDefaults("movements", "records");
    const query = browseDefaults("movements", "records");
    query.restrictItems = true;
    query.itemCodes = ["ITEM-1"];
    expect(filtersAtDefaults(query, defaults)).toBe(false);
    expect(filtersAtDefaults(query, defaults, linkedConstraintFields)).toBe(
      true,
    );
  });
});

describe("设为默认 in the date filter", () => {
  beforeEach(() => {
    localStorage.clear();
    hydrateUiPreferences("alice", defaultDisplayPreferences);
  });

  function mountFilter(save: (values: unknown) => Promise<unknown>) {
    // The app bootstrap configures saving once, so the button works on any page.
    configurePreferenceSave(save as never);
    const wrapper = mount(PeriodFilter, {
      props: {
        modelValue: { key: "this_month", from: "", to: "" },
        label: "流动日期",
        today: "2026-10-20",
        embedded: true,
        defaultArea: "movements",
      },
    });
    wrappers.push(wrapper);
    return wrapper;
  }

  const defaultButton = (wrapper: VueWrapper) =>
    wrapper.findAll("button").find((button) => button.text() === "设为默认");

  it("saves the previewed preset as the account default for this area, without any settings page", async () => {
    const save = vi.fn(async (values: unknown) => values);
    const wrapper = mountFilter(save);
    await wrapper
      .get('select[aria-label="流动日期时间范围预设"]')
      .setValue("last_30_days");
    const button = defaultButton(wrapper)!;
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    await flushPromises();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        default_periods: expect.objectContaining({
          movements: "last_30_days",
          loans: "this_month",
        }),
      }),
    );
    expect(defaultPeriods.value.movements).toBe("last_30_days");
  });

  it("is disabled when the preview already is the default", () => {
    const wrapper = mountFilter(vi.fn(async (values: unknown) => values));
    expect(defaultButton(wrapper)!.attributes("disabled")).toBeDefined();
  });

  it("is disabled for 自定义 with an explanation, because custom dates do not follow the calendar", async () => {
    const wrapper = mountFilter(vi.fn(async (values: unknown) => values));
    await wrapper
      .get('select[aria-label="流动日期时间范围预设"]')
      .setValue("custom");
    const button = defaultButton(wrapper)!;
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe(
      "自定义日期不会随时间更新，只能将预设范围设为默认",
    );
  });

  it("is not offered where the area has no account default", () => {
    const wrapper = mount(PeriodFilter, {
      props: {
        modelValue: { key: "all", from: "", to: "" },
        label: "到期日期",
        today: "2026-10-20",
        embedded: true,
      },
    });
    wrappers.push(wrapper);
    expect(defaultButton(wrapper)).toBeUndefined();
  });
});
