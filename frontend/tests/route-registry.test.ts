// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  browseDestination,
  browseStateDestination,
  documentDestination,
  exportDestination,
} from "../src/lib/nativeNavigation";
import {
  activityLoansTarget,
  activityMovementTarget,
} from "../src/features/activities/activityRoutes";
import {
  breadcrumbsForRoute,
  browseRouteTarget,
  routeRecords,
  routeRegistry,
  routeTarget,
  restoreBrowseQueryPayload,
  sanitizeBrowseQuery,
  guardReservedRoute,
  routeViewIdentity,
} from "../src/lib/routeRegistry";
import { newReportQuery } from "../src/lib/reportContract";
import { decodeReportQuery } from "../src/lib/reportQuery";
import { serializeBrowseQuery } from "../src/lib/routeRegistry";
import { serializeReportRouteQuery } from "../src/lib/routeRegistry";
import { browseDefaults } from "../src/lib/browseDefaults";
import { sortableColumnsForView } from "../src/lib/reportContract";
import { hydrateUiPreferences } from "../src/lib/uiPreferences";
import { defaultDisplayPreferences } from "../src/lib/displayPreferences";

const router = createRouter({
  history: createMemoryHistory(),
  routes: routeRecords,
});
router.beforeEach(guardReservedRoute);

describe("canonical application route registry", () => {
  it("round trips every sortable field and direction against each browse view default", () => {
    const surfaces = [
      ["inventory", "summary"],
      ["inventory", "locations"],
      ["expiry", "batches"],
      ["movements", "summary"],
      ["movements", "records"],
      ["movements", "lines"],
      ["loans", "records"],
      ["loans", "items"],
      ["loans", "outcomes"],
      ["loans", "settlements"],
      ["activities", "metadata"],
      ["activities", "records"],
      ["activities", "loans"],
      ["counts", "records"],
      ["counts", "lines"],
    ] as const;
    for (const [dataset, view] of surfaces) {
      for (const sortBy of sortableColumnsForView(dataset, view)) {
        for (const sort of ["asc", "desc"] as const) {
          const state = browseDefaults(dataset, view);
          state.sortBy = sortBy;
          state.sort = sort;
          const decoded = decodeReportQuery(
            serializeBrowseQuery(state),
            dataset,
            view,
          ).query;
          expect(decoded).toEqual(state);
        }
      }
    }
  });
  it("serializes Reports against its target view defaults", () => {
    const state = browseDefaults("movements", "records");
    state.sortBy = "identity";
    state.sort = "asc";
    const serialized = serializeReportRouteQuery(state);
    expect(JSON.parse(serialized)).toMatchObject({
      dataset: "movements",
      view: "records",
      sortBy: "identity",
      sort: "asc",
    });
    expect(decodeReportQuery(serialized).query).toEqual(state);
  });
  it("contains only named canonical routes and resolves retired paths as not found", async () => {
    const names = routeRegistry.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      "home",
      "stock",
      "item-new",
      "item-detail",
      "expiry",
      "batch-detail",
      "warehouses",
      "warehouse-detail",
      "categories",
      "pending",
      "movements",
      "movement-new",
      "movement-detail",
      "loans",
      "loan-overview",
      "counts",
      "count-new",
      "count-detail",
      "activities",
      "activity-new",
      "activity-detail",
      "activity-edit",
      "drafts",
      "reports",
      "notifications",
      "notification-settings",
      "settings",
      "setup",
      "more",
      "auth-complete",
    ]) {
      expect(names).toContain(name);
    }
    const authComplete = routeRegistry.find(
      ({ name }) => name === "auth-complete",
    );
    expect(typeof authComplete?.component).toBe("function");
    expect(
      breadcrumbsForRoute({ name: "auth-complete", params: {} }).at(-1),
    ).toMatchObject({ label: "登录成功", current: true });
    for (const oldPath of [
      "/item/ITEM-1",
      "/expiry",
      "/warehouses",
      "/new/Receive",
      "/reconcile/COUNT-1",
      "/documents/Stock%20Entry/STE-1",
      "/movements/records",
    ]) {
      await router.push(oldPath);
      expect(router.currentRoute.value.name).toBe("not-found");
    }
  });

  it("encodes native identifiers as one path segment and rejects unsupported DocTypes", () => {
    const movement = documentDestination("Stock Entry", "物品 A/批次 1");
    expect(router.resolve(movement).path).toBe(
      "/movements/%E7%89%A9%E5%93%81%20A%2F%E6%89%B9%E6%AC%A1%201",
    );
    const count = documentDestination("Stock Reconciliation", "COUNT / 甲");
    expect(router.resolve(count).path).toBe("/counts/COUNT%20%2F%20%E7%94%B2");
    expect(() => documentDestination("Purchase Receipt", "PR-1")).toThrow(
      /Unsupported native inventory document/,
    );
  });

  it("keeps browse mode in the URL and reconstructs omitted dataset/view state", () => {
    const movement = newReportQuery("movements");
    movement.view = "records";
    movement.search = "rice";
    const target = browseRouteTarget(movement);
    expect(router.resolve(target).path).toBe("/movements");
    expect(target.query).toMatchObject({ view: "records" });
    const payload = JSON.parse(String(target.query?.query));
    expect(payload).not.toHaveProperty("dataset");
    expect(payload).not.toHaveProperty("view");
    expect(
      JSON.parse(
        restoreBrowseQueryPayload(
          target.query?.query,
          "movements",
          target.query?.view,
        ) || "{}",
      ),
    ).toMatchObject({ dataset: "movements", view: "records", search: "rice" });

    const loans = browseDefaults("loans", "items");
    const loanTarget = browseStateDestination("loans", "items", loans);
    expect(loanTarget.query?.view).toBe("items");
    expect(loanTarget.query).not.toHaveProperty("query");

    for (const dataset of [
      "inventory",
      "expiry",
      "activities",
      "counts",
    ] as const) {
      const state = newReportQuery(dataset);
      state.search = "rice";
      const browse = browseRouteTarget(state);
      const encoded = JSON.parse(String(browse.query?.query));
      expect(encoded).not.toHaveProperty("dataset");
      expect(encoded).not.toHaveProperty("view");
      expect(
        JSON.parse(
          restoreBrowseQueryPayload(
            browse.query?.query,
            dataset,
            browse.query?.view,
          ) || "{}",
        ),
      ).toMatchObject({ dataset, view: state.view, search: "rice" });
    }
  });

  it("round trips default, single-filter, and deeply changed browse queries compactly", () => {
    const defaults = browseDefaults("inventory", "summary");
    const defaultTarget = browseRouteTarget(defaults);
    expect(defaultTarget.query).not.toHaveProperty("query");
    expect(serializeBrowseQuery(defaults)).toBeUndefined();
    expect(decodeReportQuery(undefined, "inventory").query).toEqual(defaults);

    const oneFilter = browseDefaults("inventory", "summary");
    oneFilter.search = "rice";
    const onePayload = serializeBrowseQuery(oneFilter);
    expect(JSON.parse(onePayload!)).toEqual({ search: "rice" });
    expect(decodeReportQuery(onePayload, "inventory").query).toEqual(oneFilter);
    expect(
      decodeReportQuery(
        restoreBrowseQueryPayload(onePayload, "inventory", oneFilter.view),
        "inventory",
      ).query,
    ).toEqual(oneFilter);

    const severalFilters = browseDefaults("movements", "records");
    severalFilters.search = "rice";
    severalFilters.sort = "desc";
    severalFilters.statuses = [0];
    severalFilters.groupBy = ["kind"];
    severalFilters.scope.warehouses = ["WH-1"];
    severalFilters.scope.period = {
      key: "custom",
      from: "2026-10-01",
      to: "2026-10-23",
    };
    const severalPayload = serializeBrowseQuery(severalFilters);
    expect(JSON.parse(severalPayload!)).toMatchObject({
      search: "rice",
      statuses: [0],
      groupBy: ["kind"],
      scope: {
        warehouses: ["WH-1"],
        period: { key: "custom", from: "2026-10-01", to: "2026-10-23" },
      },
    });
    expect(JSON.parse(severalPayload!).scope).not.toHaveProperty("categories");
    const restored = restoreBrowseQueryPayload(
      severalPayload,
      "movements",
      "records",
    );
    expect(decodeReportQuery(restored, "movements").query).toEqual(
      severalFilters,
    );

    const longForm = JSON.stringify({ ...severalFilters });
    expect(
      decodeReportQuery(
        restoreBrowseQueryPayload(longForm, "movements", "records"),
        "movements",
      ).error,
    ).toBe("");

    const historical = newReportQuery("inventory");
    historical.view = "historical";
    historical.scope.period = {
      key: "custom",
      from: "2026-10-01",
      to: "2026-10-23",
    };
    const reportTarget = browseRouteTarget(historical);
    const reportPayload = JSON.parse(String(reportTarget.query?.query));
    expect(reportPayload).toMatchObject({
      dataset: "inventory",
      view: "historical",
      scope: { period: historical.scope.period },
    });
    expect(reportPayload.scope).not.toHaveProperty("categories");
    expect(decodeReportQuery(reportTarget.query?.query).query).toEqual(
      historical,
    );
  });

  it("resolves per-area defaults and encodes explicit periods relative to them", () => {
    hydrateUiPreferences("ranges-user", {
      ...defaultDisplayPreferences,
      default_periods: {
        dashboard: "today",
        movements: "this_month",
        loans: "last_30_days",
        counts: "q1",
      },
    });
    const movement = browseDefaults("movements", "records");
    const drafts = browseDefaults("movements", "records", "drafts");
    const loan = browseDefaults("loans", "items");
    const count = browseDefaults("counts", "records");
    expect(movement.scope.period.key).toBe("this_month");
    expect(drafts.scope.period.key).toBe("all");
    expect(loan.scope.period.key).toBe("last_30_days");
    expect(count.scope.period.key).toBe("q1");
    expect(
      decodeReportQuery(undefined, "loans", "items").query.scope.period.key,
    ).toBe("last_30_days");
    expect(serializeBrowseQuery(movement)).toBeUndefined();

    movement.scope.period = { key: "all", from: "", to: "" };
    expect(JSON.parse(serializeBrowseQuery(movement)!)).toMatchObject({
      scope: { period: { key: "all" } },
    });
    const crossPage = browseStateDestination("movements", "records", movement);
    expect(JSON.parse(String(crossPage.query?.query))).toMatchObject({
      scope: { period: { key: "all" } },
    });
    const restored = decodeReportQuery(
      restoreBrowseQueryPayload(
        serializeBrowseQuery(movement),
        "movements",
        "records",
      ),
      "movements",
    );
    expect(restored.query.scope.period.key).toBe("all");

    movement.scope.period = { key: "this_month", from: "", to: "" };
    hydrateUiPreferences("ranges-user", {
      ...defaultDisplayPreferences,
      default_periods: {
        ...defaultDisplayPreferences.default_periods,
        movements: "all",
      },
    });
    expect(movement.scope.period.key).toBe("this_month");
    expect(JSON.parse(serializeBrowseQuery(movement)!)).toMatchObject({
      scope: { period: { key: "this_month" } },
    });
    hydrateUiPreferences("ranges-user", defaultDisplayPreferences);
  });

  it("sanitizes route targets to the destination view contract", () => {
    const loans = newReportQuery("movements");
    loans.view = "records";
    loans.groupBy = ["item"];
    loans.scope.activity = "ACT-1";
    loans.scope.kinds = ["Loan"];
    loans.outstandingOnly = true;
    loans.loanStatus = "outstanding";
    const target = browseRouteTarget(loans);
    const restored = restoreBrowseQueryPayload(
      target.query?.query,
      "movements",
      target.query?.view,
    );
    const decoded = decodeReportQuery(restored, "movements");
    expect(decoded.error).toBe("");
    expect(decoded.query).toMatchObject({
      dataset: "movements",
      view: "records",
      groupBy: [],
      outstandingOnly: false,
      loanStatus: "all",
      scope: { activity: "ACT-1", kinds: ["Loan"] },
    });

    const expirySource = newReportQuery("loans");
    expirySource.borrower = "张三";
    const expiryTarget = sanitizeBrowseQuery({
      ...expirySource,
      dataset: "expiry",
    });
    expect(expiryTarget.borrower).toBe("");
  });

  it("keeps every browse-link builder decodable against its target report contract", () => {
    const movement = newReportQuery("movements");
    movement.view = "records";
    movement.groupBy = ["kind"];
    movement.scope.activity = "ACT-1";
    movement.scope.kinds = ["Loan"];
    const loan = newReportQuery("loans");
    loan.view = "records";
    loan.groupBy = ["activity"];
    loan.scope.activity = "ACT-1";
    const stock = newReportQuery("inventory");
    stock.search = "rice";
    const damaged = newReportQuery("inventory");
    damaged.damageOnly = true;
    damaged.scope.warehouses = ["WH-1"];
    const expiry = newReportQuery("expiry");
    expiry.expiryWindow = "expired";
    const counts = newReportQuery("counts");
    counts.view = "records";
    const targets = [
      browseRouteTarget(movement),
      browseDestination(movement),
      browseStateDestination("movements", "records", movement),
      browseStateDestination("loans", "records", loan),
      exportDestination(stock),
      activityMovementTarget("ACT-1", "Loan"),
      activityLoansTarget("ACT-1"),
      browseRouteTarget(loan),
      browseRouteTarget(damaged),
      browseRouteTarget(expiry),
      browseRouteTarget(counts),
    ];
    for (const target of targets) {
      const name = String(target.name);
      const dataset =
        name === "stock" || name === "pending"
          ? "inventory"
          : name === "expiry"
            ? "expiry"
            : (name as "movements" | "loans" | "activities" | "counts");
      expect(router.resolve(target).matched.length, `${name} route`).toBe(1);
      const raw = target.query?.query;
      const payload =
        name === "reports"
          ? raw
          : restoreBrowseQueryPayload(raw, dataset, target.query?.view);
      const decoded = decodeReportQuery(payload, dataset);
      expect(decoded.error, `${name} browse link`).toBe("");
      if (
        target === targets[0] ||
        target === targets[1] ||
        target === targets[2]
      )
        expect(decoded.query.scope.activity).toBe("ACT-1");
    }
  });

  it("builds route-owned breadcrumb context with one current non-link segment", () => {
    const item = breadcrumbsForRoute({
      name: "item-edit",
      params: { code: "ITEM / 甲" },
    });
    expect(item.map(({ label }) => label)).toEqual([
      "物资管理",
      "库存",
      "ITEM / 甲",
      "编辑",
    ]);
    expect(item.filter(({ current }) => current)).toHaveLength(1);
    expect(item.at(-1)?.to).toBeUndefined();
    expect(item.at(-1)?.label).toBe("编辑");
    expect(item[2]?.authorizedLabel).toBe(true);
    expect(item[1]?.to).toMatchObject({ name: "stock" });
    expect(item[2]?.to).toMatchObject({
      name: "item-detail",
      params: { code: "ITEM / 甲" },
    });
    const loan = breadcrumbsForRoute({
      name: "loan-overview",
      params: { name: "借出 01" },
    });
    expect(loan.map(({ label }) => label)).toEqual([
      "物资管理",
      "借用",
      "借出 01",
    ]);
  });

  it("does not interpret More as a breadcrumb ancestor", async () => {
    const activity = breadcrumbsForRoute({
      name: "activity-detail",
      params: { name: "春季整理" },
    });
    expect(activity.map(({ label }) => label)).toEqual([
      "物资管理",
      "活动",
      "春季整理",
    ]);
    expect(activity.map(({ label }) => label)).not.toContain("更多");
    expect(routeTarget("movement-new", { kind: "Receive" }).name).toBe(
      "movement-new",
    );
    const createMovement = breadcrumbsForRoute({
      name: "movement-new",
      params: { kind: "Receive" },
    });
    expect(createMovement.map(({ label }) => label)).toEqual([
      "物资管理",
      "货物流动",
      "入库",
    ]);
    const warehouse = breadcrumbsForRoute({
      name: "warehouse-detail",
      params: { warehouse: "warehouse / 甲" },
    });
    expect(warehouse.at(-1)?.authorizedLabel).toBe(true);

    await router.push("/movements/new/Receive");
    expect(router.currentRoute.value.name).toBe("movement-new");
    await router.push("/movements/new/not-a-kind");
    expect(router.currentRoute.value.name).toBe("not-found");
  });

  it("keeps native editor component identity when autosave replaces its URL", () => {
    const create = routeRegistry.find(
      (route) => route.name === "movement-new",
    )!;
    const detail = routeRegistry.find(
      (route) => route.name === "movement-detail",
    )!;
    expect(create.stateIdentity).toBe("movement-editor");
    expect(detail.stateIdentity).toBe("movement-editor");
    expect(routeViewIdentity(create.path, 7, create.stateIdentity)).toBe(
      routeViewIdentity(detail.path, 7, detail.stateIdentity),
    );
    expect(routeViewIdentity(detail.path, 8, detail.stateIdentity)).not.toBe(
      routeViewIdentity(detail.path, 7, detail.stateIdentity),
    );
  });
});
