import { defineComponent, nextTick, reactive, ref } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLoansController } from "../src/features/loans/useLoansController";
import { usePendingController } from "../src/features/pending/usePendingController";

const state = vi.hoisted(() => ({
  api: vi.fn(),
  workspaceApi: vi.fn(async () => []),
  route: { query: {} as Record<string, unknown> },
  replace: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/api", () => ({
  api: state.api,
  workspaceApi: state.workspaceApi,
}));
vi.mock("vue-router", () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}));
vi.mock("../src/composables/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({
    surface: ref("mobile"),
    isSurface: () => false,
  }),
}));

const controllerSurface = (
  useController: typeof useLoansController | typeof usePendingController,
) =>
  defineComponent({
    setup() {
      const controller = useController();
      return {
        loading: controller.loading,
        error: controller.error,
        rows: controller.rows,
      };
    },
    template:
      '<output>{{ loading ? "正在加载" : error || (rows.length ? "有数据" : "暂无数据") }}</output>',
  });

const settle = async () => {
  await flushPromises();
  await flushPromises();
  await nextTick();
};

beforeEach(() => {
  state.api.mockReset();
  state.workspaceApi.mockClear();
  state.route.query = {};
  state.replace.mockClear();
  state.push.mockClear();
});

describe("browse loading contracts", () => {
  it("renders exactly one explicit Loans filter trigger for each active surface", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/loans/LoansView.vue"),
      "utf8",
    );
    expect(source).toMatch(
      /v-if="surface === 'desktop'"[\s\S]*?class="toolbar-action desktop-filter-button"/,
    );
    expect(source).toMatch(
      /v-if="surface === 'mobile'"[\s\S]*?class="mobile-filter-button"/,
    );
    expect(source).toContain(':show-trigger="false"');
  });

  it("offers permitted Loan and Return routes from one controller", async () => {
    state.api.mockImplementation((request: string) =>
      request === "bootstrap"
        ? Promise.resolve({
            physical_tree: [],
            item_groups: [],
            stock_operation_capabilities: { Loan: true, Return: true },
          })
        : Promise.resolve({ results: [], total: 0, overall_total: 0 }),
    );
    const surface = defineComponent({
      setup() {
        return useLoansController();
      },
      template: `<button
				v-for="action in pageActions"
				:key="action.kind"
				:data-kind="action.kind"
				@click="action.kind === 'Return' ? createReturn() : createLoan()"
			>{{ action.label }}</button>`,
    });
    const wrapper = mount(surface);
    await settle();
    expect(wrapper.text()).toContain("新建借出");
    expect(wrapper.text()).toContain("新建归还");
    await wrapper.get('[data-kind="Loan"]').trigger("click");
    await wrapper.get('[data-kind="Return"]').trigger("click");
    expect(state.push).toHaveBeenNthCalledWith(1, "/new/Loan");
    expect(state.push).toHaveBeenNthCalledWith(2, "/new/Return");
    wrapper.unmount();
  });

  it.each([
    ["loans", useLoansController, "loans"],
    ["pending", usePendingController, "pending"],
  ] as const)(
    "keeps %s busy until bootstrap and first page settle",
    async (_name, useController, method) => {
      let resolveBootstrap!: (value: unknown) => void;
      state.api.mockImplementation((request: string) => {
        if (request === "bootstrap")
          return new Promise((resolve) => {
            resolveBootstrap = resolve;
          });
        return Promise.resolve({ results: [], total: 0, overall_total: 0 });
      });
      const wrapper = mount(controllerSurface(useController));
      await nextTick();
      expect(wrapper.text()).toBe("正在加载");
      resolveBootstrap({
        physical_tree: [],
        item_groups: [],
        stock_operation_capabilities: {},
      });
      await settle();
      expect(state.api.mock.calls.some(([request]) => request === method)).toBe(
        true,
      );
      await settle();
      expect(wrapper.text()).toBe("暂无数据");
      wrapper.unmount();
    },
  );

  it.each([
    ["loans", useLoansController, "loans"],
    ["pending", usePendingController, "pending"],
  ] as const)(
    "transitions %s from loading to data",
    async (_name, useController, method) => {
      state.api.mockImplementation((request: string) =>
        request === "bootstrap"
          ? Promise.resolve({
              physical_tree: [],
              item_groups: [],
              stock_operation_capabilities: {},
            })
          : Promise.resolve({
              results: [{ name: "ROW-1", item_code: "ITEM-1" }],
              total: 1,
            }),
      );
      const wrapper = mount(controllerSurface(useController));
      expect(wrapper.text()).toBe("正在加载");
      await settle();
      expect(state.api.mock.calls.some(([request]) => request === method)).toBe(
        true,
      );
      expect(wrapper.text()).toBe("有数据");
      wrapper.unmount();
    },
  );

  it.each([
    ["loans", useLoansController, "loan bootstrap failed"],
    ["pending", usePendingController, "pending bootstrap failed"],
  ] as const)(
    "settles %s loading on bootstrap errors",
    async (_name, useController, message) => {
      state.api.mockImplementation((request: string) =>
        request === "bootstrap"
          ? Promise.reject(new Error(message))
          : Promise.resolve({}),
      );
      const wrapper = mount(controllerSurface(useController));
      await settle();
      expect(wrapper.text()).toBe(message);
      wrapper.unmount();
    },
  );
});
