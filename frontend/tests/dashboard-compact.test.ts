// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import DashboardView from "../src/features/dashboard/DashboardView.vue";
import {
  useDashboardController,
  type DashboardResult,
} from "../src/features/dashboard/useDashboardController";
import { movementLabels } from "../src/lib/presentationLabels";
import { newReportQuery } from "../src/lib/reportContract";
import { locationTip } from "../src/lib/warehouseLabel";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
  type LocationNode,
} from "../src/services/contracts";
import { RouterLinkStub } from "./support/RouterLinkStub";
import { tooltipBinding } from "./support/tooltipBinding";

const warehouses = Array.from({ length: 10 }, (_, index): LocationNode => ({
  name: `W-${index}`,
  label: `A/R${index}`,
  local_label: `库房 ${index}`,
  short_label: `R${index}`,
  full_label: `库房 ${index}`,
  path: `A/R${index}`,
  path_segments: ["A", `R${index}`],
  path_names: ["主院", `库房 ${index}`],
  search_text: "",
  kind: "room",
  owner: "",
  direct: false,
  storable: true,
  missing_direct: false,
  parent: "A",
  is_group: false,
  disabled: false,
  lft: index * 2 + 1,
  rgt: index * 2 + 2,
  version: "1",
  protected: false,
  can_edit: true,
}));
const wrappers: VueWrapper[] = [];
let instance = 0;

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function dashboard(movement: Partial<DashboardResult> = {}) {
  const reference = createReferenceData();
  reference.user = `dashboard-compact-${++instance}`;
  reference.siteDate = "2026-11-26";
  reference.warehouses = warehouses;
  const services: InventoryServices = {
    call: vi.fn(async (_endpoint, args) => {
      if (args?.card === "movement") return movement;
      if (args?.card !== "distribution") return {};
      if (args.distribution === "category")
        return { rows: [{ id: "W-0", label: "食品类别", item_count: 9 }] };
      return {
        rows: warehouses.slice(0, 9).map(({ name, label }) => ({
          id: name,
          label,
          item_count: 1,
        })),
        empty_count: 1,
        empty_locations: [{ id: "W-9", label: warehouses[9]!.label }],
      };
    }) as InventoryServices["call"],
    report: vi.fn(),
    upload: vi.fn(),
  };
  const child = defineComponent({
    setup() {
      const controller = useDashboardController(vi.fn());
      return () => h(DashboardView, { controller });
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(services, reference);
        return () => h(child);
      },
    }),
    { global: { stubs: { RouterLink: RouterLinkStub } } },
  );
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe("dashboard movement and distribution", () => {
  it("renders a single thumbnail for the first named item and the shared missing-image placeholder", async () => {
    const image = "/private/files/first.webp";
    const wrapper = await dashboard({
      query: newReportQuery("movements"),
      rows: [
        {
          doctype: "Stock Entry",
          document: "RECEIVE-1",
          kind: "Receive",
          item_code: "A01",
          item_names: ["大米", "苹果"],
          item_count: 2,
          image,
          quantities: [{ uom: "Nos", qty: 5 }],
        },
        {
          doctype: "Stock Entry",
          document: "RECEIVE-2",
          kind: "Receive",
          item_code: "B02",
          item_names: ["餐具"],
          item_count: 1,
          image: "",
        },
      ],
    });
    const [first, second] = wrapper.findAll(
      ".dashboard-movement .browse-rank-row",
    );
    expect(first!.findAll("img")).toHaveLength(1);
    expect(first!.get("img").attributes("src")).toContain("item=A01&size=160");
    expect(first!.get(".async-image").attributes("aria-label")).toBe("大米");
    const link = first!.get(".dashboard-record-link");
    expect(link.text()).toContain("大米 等 2 种物品");
    expect(link.attributes("aria-label")).toContain("大米、苹果");
    expect(first!.get(".dashboard-record-values").text()).toContain("5");
    expect(second!.get(".async-image--empty").attributes("aria-label")).toBe(
      "餐具",
    );
  });

  it("registers location tooltips on top bars, disclosed bars and empty locations", async () => {
    const wrapper = await dashboard();
    const top = wrapper.get(".distribution > .chart-bar");
    const rest = wrapper.get(".dashboard-inline-disclosure .chart-bar");
    const empty = wrapper.get(".dashboard-empty-locations li");
    expect(tooltipBinding(top.element)).toEqual(locationTip("W-0", warehouses));
    expect(tooltipBinding(rest.element)).toEqual(
      locationTip("W-8", warehouses),
    );
    expect(tooltipBinding(empty.element)).toEqual(
      locationTip("W-9", warehouses),
    );
    expect(empty.text()).toContain(warehouses[9]!.label);

    await wrapper.get('[data-distribution-tab="category"]').trigger("click");
    await flushPromises();
    const category = wrapper.get(".distribution > .chart-bar");
    expect(tooltipBinding(category.element)).toBeUndefined();
    expect(tooltipBinding(category.get("span").element)).toBe("食品类别");
    expect(wrapper.find(".dashboard-empty-locations").exists()).toBe(false);
  });

  it("puts zero-count chip links after populated tiles in the usual kind order", async () => {
    const wrapper = await dashboard({ kind_counts: { Issue: 3, Loan: 2 } });
    const links = wrapper.findAll(
      ".dashboard-movement-tile, .dashboard-movement-chip",
    );
    const kinds = Object.keys(movementLabels);
    const nonzero = kinds.filter((kind) => ["Issue", "Loan"].includes(kind));
    const zero = kinds.filter((kind) => !nonzero.includes(kind));
    expect(links.map((link) => link.classes()[0])).toEqual([
      ...nonzero.map(() => "dashboard-movement-tile"),
      ...zero.map(() => "dashboard-movement-chip"),
    ]);
    for (const [index, kind] of [...nonzero, ...zero].entries()) {
      const link = links[index]!;
      const count = kind === "Issue" ? 3 : kind === "Loan" ? 2 : 0;
      const url = new URL(
        link.attributes("href")!,
        "https://inventory.example",
      );
      expect(url.pathname).toBe("/movements");
      expect(JSON.parse(url.searchParams.get("query")!).scope.kinds).toEqual([
        kind,
      ]);
      expect(link.attributes("aria-label")).toBe(
        `${movementLabels[kind]}，${count} 笔记录`,
      );
    }
  });

  it("renders just the chip row when every kind has zero records", async () => {
    const wrapper = await dashboard();
    expect(wrapper.find(".movement-summary").exists()).toBe(false);
    expect(wrapper.findAll(".dashboard-movement-chips")).toHaveLength(1);
    expect(
      wrapper.findAll(".dashboard-movement-chip").map((link) => link.text()),
    ).toEqual(Object.values(movementLabels).map((label) => `${label} 0`));
  });
});
