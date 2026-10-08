import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineComponent, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InventoryPage from "../src/features/inventory/InventoryPage.vue";
import ExpiryPage from "../src/features/expiry/ExpiryPage.vue";
import MovementsPage from "../src/features/movements/MovementsPage.vue";
import HistoryPage from "../src/features/history/HistoryPage.vue";
import LoansPage from "../src/features/loans/LoansPage.vue";
import PendingPage from "../src/features/pending/PendingPage.vue";
import MovementOverviewPage from "../src/features/movement-overview/MovementOverviewPage.vue";

type Surface = "desktop" | "mobile";
type ControllerStub = { surface: Ref<Surface>; rows: Ref<unknown[]> };

const state = vi.hoisted(() => ({
  controllers: {} as Record<string, ControllerStub>,
}));

vi.mock("../src/features/inventory/useInventoryController", () => ({
  useInventoryController: () => state.controllers.inventory,
}));
vi.mock("../src/features/expiry/useExpiryController", () => ({
  useExpiryController: () => state.controllers.expiry,
}));
vi.mock("../src/features/movements/useMovementsController", () => ({
  useMovementsController: () => state.controllers.movements,
}));
vi.mock("../src/features/history/useHistoryController", () => ({
  useHistoryController: () => state.controllers.history,
}));
vi.mock("../src/features/loans/useLoansController", () => ({
  useLoansController: () => state.controllers.loans,
}));
vi.mock("../src/features/pending/usePendingController", () => ({
  usePendingController: () => state.controllers.pending,
}));
vi.mock(
  "../src/features/movement-overview/useMovementOverviewController",
  () => ({
    useMovementOverviewController: () => state.controllers.movementOverview,
  }),
);

const pairedStub = (name: string, surface: Surface) =>
  defineComponent({
    name,
    props: { controller: { type: Object, required: true } },
    template: `<div :data-surface="'${surface}'" />`,
  });

const adaptiveStub = defineComponent({
  name: "AdaptiveFeatureView",
  props: {
    controller: { type: Object, required: true },
    surface: { type: String, required: true },
  },
  template:
    '<div class="adaptive-surface" :data-surface="surface">{{ controller.rows.value.length }}</div>',
});

const pairedCases = [
  {
    key: "inventory",
    Page: InventoryPage,
    desktop: "InventoryDesktopView",
    mobile: "InventoryMobileView",
  },
  {
    key: "expiry",
    Page: ExpiryPage,
    desktop: "ExpiryDesktopView",
    mobile: "ExpiryMobileView",
  },
] as const;

const adaptiveCases = [
  { key: "movements", Page: MovementsPage, view: "MovementsView" },
  { key: "history", Page: HistoryPage, view: "HistoryView" },
  { key: "loans", Page: LoansPage, view: "LoansView" },
  { key: "pending", Page: PendingPage, view: "PendingView" },
  {
    key: "movementOverview",
    Page: MovementOverviewPage,
    view: "MovementOverviewView",
  },
] as const;

const sharedOverlayStubs = {
  InventorySharedOverlays: true,
  ExpirySharedOverlays: true,
};

beforeEach(() => {
  for (const entry of [...pairedCases, ...adaptiveCases]) {
    state.controllers[entry.key] = {
      surface: ref("mobile"),
      rows: ref([{ id: entry.key }]),
    };
  }
});

describe("paired responsive surface coordinators", () => {
  it.each(pairedCases)(
    "mounts one $key surface and retains its controller state",
    async (entry) => {
      const controller = state.controllers[entry.key];
      const wrapper = mount(entry.Page, {
        global: {
          stubs: {
            ...sharedOverlayStubs,
            [entry.desktop]: pairedStub(entry.desktop, "desktop"),
            [entry.mobile]: pairedStub(entry.mobile, "mobile"),
          },
        },
      });

      expect(wrapper.find('[data-surface="mobile"]').exists()).toBe(true);
      expect(wrapper.find('[data-surface="desktop"]').exists()).toBe(false);
      controller.rows.value.push({ id: "retained" });
      controller.surface.value = "desktop";
      await nextTick();
      expect(wrapper.find('[data-surface="desktop"]').exists()).toBe(true);
      expect(wrapper.find('[data-surface="mobile"]').exists()).toBe(false);
      expect(controller.rows.value).toHaveLength(2);
      wrapper.unmount();
    },
  );
});

describe("adaptive same-flow surface coordinators", () => {
  it.each(adaptiveCases)(
    "mounts one $key view, passes its active surface, and retains state",
    async (entry) => {
      const controller = state.controllers[entry.key];
      const wrapper = mount(entry.Page, {
        global: {
          stubs: {
            ...sharedOverlayStubs,
            [entry.view]: adaptiveStub,
          },
        },
      });

      expect(wrapper.findAllComponents(adaptiveStub)).toHaveLength(1);
      expect(wrapper.find(".adaptive-surface").attributes("data-surface")).toBe(
        "mobile",
      );
      controller.rows.value.push({ id: "retained" });
      controller.surface.value = "desktop";
      await nextTick();
      expect(wrapper.findAllComponents(adaptiveStub)).toHaveLength(1);
      expect(wrapper.find(".adaptive-surface").attributes("data-surface")).toBe(
        "desktop",
      );
      expect(wrapper.find(".adaptive-surface").text()).toBe("2");
      wrapper.unmount();
    },
  );
});

describe("responsive feature ownership", () => {
  it("keeps same-flow browse surfaces single-owned instead of duplicating full views", () => {
    const featureRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../src/features",
    );
    const shared = [
      [
        "history",
        "HistoryView.vue",
        "HistoryDesktopView.vue",
        "HistoryMobileView.vue",
      ],
      ["loans", "LoansView.vue", "LoansDesktopView.vue", "LoansMobileView.vue"],
      [
        "movement-overview",
        "MovementOverviewView.vue",
        "MovementOverviewDesktopView.vue",
        "MovementOverviewMobileView.vue",
      ],
      [
        "movements",
        "MovementsView.vue",
        "MovementsDesktopView.vue",
        "MovementsMobileView.vue",
      ],
      [
        "pending",
        "PendingView.vue",
        "PendingDesktopView.vue",
        "PendingMobileView.vue",
      ],
    ] as const;

    for (const [domain, adaptive, desktop, mobile] of shared) {
      expect(existsSync(resolve(featureRoot, domain, adaptive))).toBe(true);
      expect(existsSync(resolve(featureRoot, domain, desktop))).toBe(false);
      expect(existsSync(resolve(featureRoot, domain, mobile))).toBe(false);
      expect(
        readFileSync(resolve(featureRoot, domain, adaptive), "utf8"),
      ).not.toContain("<slot");
    }

    const inventoryDesktop = readFileSync(
      resolve(featureRoot, "inventory", "InventoryDesktopView.vue"),
      "utf8",
    );
    const inventoryMobile = readFileSync(
      resolve(featureRoot, "inventory", "InventoryMobileView.vue"),
      "utf8",
    );
    const expiryDesktop = readFileSync(
      resolve(featureRoot, "expiry", "ExpiryDesktopView.vue"),
      "utf8",
    );
    const expiryMobile = readFileSync(
      resolve(featureRoot, "expiry", "ExpiryMobileView.vue"),
      "utf8",
    );
    expect(inventoryDesktop).not.toContain("@media (max-width: 1023px)");
    expect(inventoryMobile).not.toContain("@media (min-width: 1024px)");
    expect(expiryDesktop).not.toContain("@media (max-width: 1023px)");
    expect(expiryMobile).not.toContain("@media (min-width: 1024px)");
  });
});
