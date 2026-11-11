// @vitest-environment jsdom

import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

vi.mock("../src/features/items/ProductDetailPage.vue", async () => {
  const { defineComponent, h, ref } = await import("vue");
  return {
    default: defineComponent({
      emits: ["back"],
      setup(_, { expose, emit }) {
        expose({
          controller: { conversionDirty: ref(false), item: ref(undefined) },
        });
        return () => h("button", { onClick: () => emit("back") }, "返回");
      },
    }),
  };
});

import ItemDetail from "../src/pages/ItemDetail.vue";

vi.mock("../src/services/confirm", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));
vi.mock("../src/lib/routeBreadcrumbLabel", () => ({
  useRouteBreadcrumbLabel: vi.fn(),
}));

describe("item detail back navigation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns to stock when the detail URL was opened without history", async () => {
    vi.spyOn(window.history, "state", "get").mockReturnValue({});
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/stock",
          name: "stock",
          component: { render: () => h("p", "库存") },
        },
        {
          path: "/stock/items/:code",
          name: "item-detail",
          component: ItemDetail,
        },
        {
          path: "/stock/items/:code/edit",
          name: "item-edit",
          component: { render: () => h("p") },
        },
        {
          path: "/doc/:doctype/:name",
          name: "document",
          component: { render: () => h("p") },
        },
        {
          path: "/export",
          name: "export",
          component: { render: () => h("p") },
        },
        {
          path: "/loan/:name",
          name: "loan-overview",
          component: { render: () => h("p") },
        },
        {
          path: "/:pathMatch(.*)*",
          name: "not-found",
          component: { render: () => h("p") },
        },
      ],
    });
    await router.push({ name: "item-detail", params: { code: "ITEM-0" } });
    await router.isReady();
    const wrapper = mount(
      defineComponent({
        render: () => h(RouterView),
      }),
      {
        global: {
          plugins: [router],
        },
      },
    );
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("stock");
    wrapper.unmount();
  });
});
