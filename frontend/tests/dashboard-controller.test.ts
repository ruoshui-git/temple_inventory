import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn(), replace: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mocks.api }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: mocks.replace }),
}));

import { useDashboardController } from "../src/features/dashboard/useDashboardController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fullResult(label: string) {
  return {
    generated_at: label,
    scope: { warehouses: [], item_groups: [] },
    warehouses: [],
    item_groups: [],
    inventory: { totals: {} },
    expiry: { buckets: {}, preview: [], preview_mode: "expired" },
    movement: {
      period: { key: label },
      summaries: [],
      recent: [{ item_name: label }],
    },
    loans: { record_count: 0, quantity: {}, rows: [] },
    reminders: [],
    distribution: {
      mode: "warehouse",
      bars: [{ key: label, distinct_items: 1 }],
    },
  };
}

function harness() {
  let controller!: ReturnType<typeof useDashboardController>;
  const wrapper = mount(
    defineComponent({
      setup() {
        controller = useDashboardController();
        return () => h("div");
      },
    }),
  );
  return { controller, wrapper };
}

describe("dashboard controller section requests", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.replace.mockReset().mockResolvedValue(undefined);
  });

  it("requests only the local section and keeps the newest local result over an older full response", async () => {
    const initial = deferred<any>();
    mocks.api.mockReturnValueOnce(initial.promise);
    const { controller, wrapper } = harness();
    initial.resolve(fullResult("initial"));
    await flushPromises();

    const refresh = deferred<any>();
    mocks.api.mockReturnValueOnce(refresh.promise);
    controller.refresh();
    await nextTick();
    expect(mocks.api.mock.calls[1][1]).not.toHaveProperty("sections");

    const local = deferred<any>();
    mocks.api.mockReturnValueOnce(local.promise);
    controller.distributionMode.value = "category";
    await nextTick();
    expect(mocks.api.mock.calls[2][1].sections).toEqual(["distribution"]);
    local.resolve({
      generated_at: "local",
      scope: { warehouses: [], item_groups: [] },
      distribution: {
        mode: "category",
        bars: [{ key: "category", distinct_items: 4 }],
      },
    });
    await flushPromises();
    refresh.resolve(fullResult("older-full"));
    await flushPromises();
    expect(controller.data.value.distribution.mode).toBe("category");
    expect(controller.data.value.distribution.bars[0].key).toBe("category");
    wrapper.unmount();
  });

  it("rejects local work after a newer scope-wide refresh and retains stale data on failure", async () => {
    const initial = deferred<any>();
    mocks.api.mockReturnValueOnce(initial.promise);
    const { controller, wrapper } = harness();
    initial.resolve(fullResult("initial"));
    await flushPromises();

    const oldLocal = deferred<any>();
    mocks.api.mockReturnValueOnce(oldLocal.promise);
    controller.movementPeriod.value = "this_week";
    await nextTick();
    expect(mocks.api.mock.calls[1][1].sections).toEqual(["movement"]);

    const latestFull = deferred<any>();
    mocks.api.mockReturnValueOnce(latestFull.promise);
    controller.refresh();
    await nextTick();
    latestFull.resolve(fullResult("latest"));
    await flushPromises();
    oldLocal.resolve({
      movement: { period: { key: "old" }, summaries: [], recent: [] },
    });
    await flushPromises();
    expect(controller.data.value.movement.period.key).toBe("latest");

    const failure = deferred<any>();
    mocks.api.mockReturnValueOnce(failure.promise);
    controller.expiryPreview.value = "upcoming";
    await nextTick();
    failure.reject(new Error("读取失败"));
    await flushPromises();
    expect(controller.data.value.expiry.preview_mode).toBe("expired");
    expect(controller.sectionError("expiry")).toBe("读取失败");
    expect(controller.sectionStale("expiry")).toBe(true);
    wrapper.unmount();
  });

  it("uses a full retry after the initial request fails", async () => {
    mocks.api.mockRejectedValueOnce(new Error("offline"));
    const { controller, wrapper } = harness();
    await flushPromises();
    expect(controller.hasSuccessfulData.value).toBe(false);

    const retry = deferred<any>();
    mocks.api.mockReturnValueOnce(retry.promise);
    controller.retrySection("movement");
    await nextTick();
    expect(mocks.api.mock.calls[1][1]).not.toHaveProperty("sections");
    retry.resolve(fullResult("recovered"));
    await flushPromises();
    expect(controller.hasSuccessfulData.value).toBe(true);
    expect(controller.data.value.loans).toBeDefined();
    wrapper.unmount();
  });

  it("ignores older values, timestamps, and failures when requests target one section", async () => {
    const initial = deferred<any>();
    mocks.api.mockReturnValueOnce(initial.promise);
    const { controller, wrapper } = harness();
    initial.resolve(fullResult("initial"));
    await flushPromises();

    const first = deferred<any>();
    const second = deferred<any>();
    mocks.api
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    controller.movementPeriod.value = "this_week";
    await nextTick();
    controller.movementPeriod.value = "this_year";
    await nextTick();
    second.resolve({
      generated_at: "newest-time",
      scope: { warehouses: [], item_groups: [] },
      movement: { period: { key: "newest" }, summaries: [], recent: [] },
    });
    await flushPromises();
    first.resolve({
      generated_at: "older-time",
      scope: { warehouses: [], item_groups: [] },
      movement: { period: { key: "older" }, summaries: [], recent: [] },
    });
    await flushPromises();
    expect(controller.data.value.movement.period.key).toBe("newest");
    expect(controller.data.value.generated_at).toBe("newest-time");

    const oldFailure = deferred<any>();
    const latest = deferred<any>();
    mocks.api
      .mockReturnValueOnce(oldFailure.promise)
      .mockReturnValueOnce(latest.promise);
    controller.movementPeriod.value = "all";
    await nextTick();
    controller.movementPeriod.value = "this_month";
    await nextTick();
    latest.resolve({
      movement: {
        period: { key: "latest-success" },
        summaries: [],
        recent: [],
      },
    });
    await flushPromises();
    oldFailure.reject(new Error("older failure"));
    await flushPromises();
    expect(controller.data.value.movement.period.key).toBe("latest-success");
    expect(controller.sectionError("movement")).toBe("");
    wrapper.unmount();
  });

  it("marks all cards stale at filter intent and ignores pending local data until the new scope loads", async () => {
    const initial = deferred<any>();
    mocks.api.mockReturnValueOnce(initial.promise);
    const { controller, wrapper } = harness();
    initial.resolve(fullResult("initial"));
    await flushPromises();

    const oldLocal = deferred<any>();
    mocks.api.mockReturnValueOnce(oldLocal.promise);
    controller.movementPeriod.value = "this_week";
    await nextTick();

    const routeChange = deferred<void>();
    mocks.replace.mockReturnValueOnce(routeChange.promise);
    const filterChange = controller.updateFilters({
      warehouses: ["NEW-WAREHOUSE"],
      item_groups: [],
    });
    expect(controller.sectionBusy("inventory")).toBe(true);
    expect(controller.sectionBusy("distribution")).toBe(true);
    oldLocal.resolve({
      movement: { period: { key: "old-scope" }, summaries: [], recent: [] },
    });
    await flushPromises();
    expect(controller.data.value.movement.period.key).toBe("initial");

    const newFull = deferred<any>();
    mocks.api.mockReturnValueOnce(newFull.promise);
    routeChange.resolve();
    await nextTick();
    expect(mocks.api.mock.calls.at(-1)?.[1].warehouses).toEqual([
      "NEW-WAREHOUSE",
    ]);
    newFull.resolve(fullResult("new-scope"));
    await filterChange;
    expect(controller.data.value.movement.period.key).toBe("new-scope");
    expect(controller.sectionBusy("inventory")).toBe(false);
    wrapper.unmount();
  });

  it("retries only the failed card after the initial full load succeeded", async () => {
    const initial = deferred<any>();
    mocks.api.mockReturnValueOnce(initial.promise);
    const { controller, wrapper } = harness();
    initial.resolve(fullResult("initial"));
    await flushPromises();

    const failure = deferred<any>();
    mocks.api.mockReturnValueOnce(failure.promise);
    controller.expiryPreview.value = "upcoming";
    await nextTick();
    failure.reject(new Error("expiry unavailable"));
    await flushPromises();

    const retry = deferred<any>();
    mocks.api.mockReturnValueOnce(retry.promise);
    controller.retrySection("expiry");
    await nextTick();
    expect(mocks.api.mock.calls.at(-1)?.[1].sections).toEqual(["expiry"]);
    retry.resolve({
      expiry: { buckets: {}, preview: [], preview_mode: "upcoming" },
    });
    await flushPromises();
    expect(controller.data.value.expiry.preview_mode).toBe("upcoming");
    expect(controller.sectionError("expiry")).toBe("");
    wrapper.unmount();
  });
});
