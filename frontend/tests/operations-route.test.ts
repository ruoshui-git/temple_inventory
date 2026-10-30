// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import Operations from "../src/pages/Operations.vue";
import { newReportQuery } from "../src/lib/reportContract";
import { routeRecords } from "../src/lib/routeRegistry";

vi.mock("../src/features/movements/OperationBrowsePage.vue", () => ({
  default: defineComponent({
    props: ["family", "records", "routeQuery"],
    emits: ["query-change"],
    setup(_, { emit }) {
      return () =>
        h("button", {
          onClick: () => emit("query-change", newReportQuery("loans")),
        });
    },
  }),
}));

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("operation browse route state", () => {
  it("removes the cleared loan scope while retaining the target view", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: routeRecords.map((record) =>
        record.name === "loans" ? { ...record, component: Operations } : record,
      ),
    });
    await router.push(
      "/loans?view=items&query=%7B%22loanScope%22%3A%22all%22%7D",
    );
    const wrapper = mount(Operations, {
      props: { family: "loans" },
      global: { plugins: [router] },
    });
    wrappers.push(wrapper);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.view).toBe("items");
    expect(String(router.currentRoute.value.query.query)).not.toContain(
      '"loanScope":"all"',
    );
  });
});
