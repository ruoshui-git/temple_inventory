import { defineComponent, nextTick, reactive, ref } from "vue";
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
      expect(state.api).toHaveBeenCalledWith(method, expect.anything());
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
      expect(state.api).toHaveBeenCalledWith(method, expect.anything());
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
