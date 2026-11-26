// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import NativeWarehousesPage from "../src/features/warehouses/NativeWarehousesPage.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type LocationNode,
} from "../src/services/contracts";

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function node(
  name: string,
  parent: string,
  kind: LocationNode["kind"],
  lft: number,
  rgt: number,
  direct = false,
): LocationNode {
  return {
    name,
    parent,
    kind,
    lft,
    rgt,
    direct,
    owner: direct ? parent : "",
    label: name,
    local_label: name,
    short_label: "",
    full_label: name,
    search_text: name,
    path: name,
    is_group: !direct,
    storable: direct,
    missing_direct: false,
    disabled: false,
    version: "v1",
    protected: false,
    can_edit: false,
  };
}

it("only expands warehouses with children that the tree can show", async () => {
  const rows = [
    node("ROOT", "", "system", 1, 22),
    node("EMPTY-AREA", "ROOT", "area", 2, 3),
    node("ROOM", "ROOT", "room", 4, 7),
    node("ROOM-DIRECT", "ROOM", "room", 5, 6, true),
    node("PARENT-ROOM", "ROOT", "room", 8, 13),
    node("SHELF", "PARENT-ROOM", "shelf", 9, 12),
    node("SHELF-DIRECT", "SHELF", "shelf", 10, 11, true),
    node("SCOPED-AREA", "ROOT", "area", 14, 21),
    node("SCOPED-ROOM", "INACCESSIBLE-AREA", "room", 17, 18),
  ];
  const call = vi.fn(async (method: string) => {
    if (method === "warehouses.tree")
      return {
        rows,
        physical_root: "ROOT",
        can_create: false,
        company: "TEMPLE",
      };
    if (method === "warehouses.stock_summary") return { rows: [] };
    return {};
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { render: () => null } }],
  });
  await router.push("/");
  const reference = createReferenceData();
  Object.assign(reference, { site: "chevron-test", user: "viewer" });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(NativeWarehousesPage);
      },
    }),
    { global: { plugins: [router] } },
  );
  await flushPromises();

  const row = (name: string) =>
    wrapper.find(`[data-browse-row="warehouse:${name}"]`);
  const rootToggle = row("ROOT").get("button.warehouse-toggle");
  const parentToggle = row("PARENT-ROOM").get("button.warehouse-toggle");
  expect(rootToggle.attributes("aria-expanded")).toBe("true");
  expect(parentToggle.attributes("aria-expanded")).toBe("true");
  const scopedToggle = row("SCOPED-AREA").get("button.warehouse-toggle");
  await scopedToggle.trigger("click");
  expect(row("SCOPED-ROOM").exists()).toBe(false);
  await scopedToggle.trigger("click");
  expect(row("SCOPED-ROOM").exists()).toBe(true);
  for (const name of ["EMPTY-AREA", "ROOM", "SHELF"]) {
    expect(
      row(name).get("span.warehouse-toggle").attributes("aria-hidden"),
    ).toBe("true");
    expect(row(name).find("button.warehouse-toggle").exists()).toBe(false);
  }
  await parentToggle.trigger("click");
  expect(parentToggle.attributes("aria-expanded")).toBe("false");
  expect(row("SHELF").exists()).toBe(false);
  await parentToggle.trigger("click");
  expect(row("SHELF").exists()).toBe(true);

  const search = wrapper.get('input[aria-label="搜索仓库"]');
  vi.useFakeTimers();
  async function searchFor(value: string) {
    await search.setValue(value);
    await vi.advanceTimersByTimeAsync(220);
  }
  await searchFor("EMPTY-AREA");
  expect(row("EMPTY-AREA").get("span.warehouse-toggle").exists()).toBe(true);
  expect(row("PARENT-ROOM").exists()).toBe(false);
  await searchFor("ROOM-DIRECT");
  expect(row("ROOM").get("span.warehouse-toggle").exists()).toBe(true);
  expect(row("ROOM-DIRECT").exists()).toBe(false);
  await searchFor("PARENT-ROOM");
  expect(row("PARENT-ROOM").get("span.warehouse-toggle").exists()).toBe(true);
  await searchFor("SHELF");
  const searchToggle = row("PARENT-ROOM").get("button.warehouse-toggle");
  expect(searchToggle.attributes("aria-expanded")).toBe("true");
  expect(row("SHELF").get("span.warehouse-toggle").exists()).toBe(true);
  await searchToggle.trigger("click");
  expect(searchToggle.attributes("aria-expanded")).toBe("false");
  expect(row("SHELF").exists()).toBe(false);
  await searchFor("");
  expect(row("SHELF").exists()).toBe(true);
  // Collapsed search branches belong to their term: the same term keeps them, a new term opens all.
  await searchFor("SHELF");
  expect(row("SHELF").exists()).toBe(false);
  await searchFor("SHEL");
  expect(row("SHELF").exists()).toBe(true);
});
