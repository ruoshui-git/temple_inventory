import { defineComponent, h, nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWarehouseDetailController } from "../src/features/warehouse-detail/useWarehouseDetailController";
import WarehouseDetailView from "../src/features/warehouse-detail/WarehouseDetailView.vue";

const state = vi.hoisted(() => ({
  route: { params: { warehouse: "WH-1" } },
  api: vi.fn(),
  push: vi.fn(),
  go: vi.fn(),
}));
const route = reactive(state.route);

vi.mock("../src/lib/api", () => ({ api: state.api }));
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push: state.push, go: state.go }),
}));

const makeDetail = (stockName: string, movementName: string) => ({
  warehouse: { name: "WH-1", warehouse_name: "主仓", is_group: 0 },
  warehouse_tree: [{ name: "WH-1", warehouse_name: "主仓", is_group: 0 }],
  stock_preview: [
    { item_code: "A001", item_name: stockName, qty: 4, uom: "Nos" },
  ],
  movements: [{ name: "MOV-1", item_name: movementName, qty: 2, uom: "Nos" }],
});

let controller!: ReturnType<typeof useWarehouseDetailController>;
const Host = defineComponent({
  setup() {
    controller = useWarehouseDetailController();
    return () => h(WarehouseDetailView, { controller });
  },
});

beforeEach(() => {
  state.route.params = { warehouse: "WH-1" };
  state.api.mockReset();
  state.push.mockReset();
  state.go.mockReset();
  state.api.mockImplementation(async (method: string) => {
    if (method === "bootstrap") return { warehouse_tree: [] };
    if (method === "warehouse_detail")
      return makeDetail("原有库存", "原有动态");
    throw new Error(`unexpected API method: ${method}`);
  });
});

describe("warehouse detail loading", () => {
  it("loads once initially and keeps both regions busy with retained data during overlapping refreshes", async () => {
    const wrapper = mount(Host, {
      global: {
        stubs: {
          RouterLink: { template: "<a><slot /></a>" },
          ExportDialog: true,
        },
      },
    });
    await flushPromises();

    expect(
      state.api.mock.calls.filter(([method]) => method === "bootstrap"),
    ).toHaveLength(1);
    expect(
      state.api.mock.calls.filter(([method]) => method === "warehouse_detail"),
    ).toHaveLength(1);
    expect(controller.detail.value.stock_preview[0].item_name).toBe("原有库存");
    expect(controller.stockLoading.value).toBe(false);
    expect(controller.movementsLoading.value).toBe(false);
    expect(wrapper.find(".detail-list").attributes("inert")).toBeUndefined();
    expect(
      wrapper.findAll(".detail-list")[1].attributes("inert"),
    ).toBeUndefined();
    expect(wrapper.text()).toContain("查看全部库存");

    let finishFirst!: (value: unknown) => void;
    state.api.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    const first = controller.loadStock();
    await nextTick();
    expect(controller.stockLoading.value).toBe(true);
    expect(controller.movementsLoading.value).toBe(true);
    expect(
      wrapper.findAll(".detail-list")[0].attributes("inert"),
    ).toBeDefined();
    expect(
      wrapper.findAll(".detail-list")[1].attributes("inert"),
    ).toBeDefined();
    expect(
      wrapper.find(".section-heading a").attributes("inert"),
    ).toBeUndefined();
    expect(controller.detail.value.movements[0].item_name).toBe("原有动态");

    let finishLatest!: (value: unknown) => void;
    state.api.mockImplementationOnce(
      () => new Promise((resolve) => (finishLatest = resolve)),
    );
    const latest = controller.loadMovements();
    finishFirst(makeDetail("过期库存响应", "过期动态响应"));
    await first;
    expect(controller.stockLoading.value).toBe(true);
    expect(controller.movementsLoading.value).toBe(true);
    expect(controller.detail.value.stock_preview[0].item_name).toBe("原有库存");

    finishLatest(makeDetail("新库存", "新动态"));
    await latest;
    expect(controller.detail.value.stock_preview[0].item_name).toBe("新库存");
    expect(controller.detail.value.movements[0].item_name).toBe("新动态");
    expect(controller.stockLoading.value).toBe(false);
    expect(controller.movementsLoading.value).toBe(false);
    expect(
      wrapper.findAll(".detail-list")[0].attributes("inert"),
    ).toBeUndefined();
    expect(
      wrapper.findAll(".detail-list")[1].attributes("inert"),
    ).toBeUndefined();
    wrapper.unmount();
  });

  it("retains populated detail on read failure and retries the full read", async () => {
    const wrapper = mount(Host, {
      global: {
        stubs: {
          RouterLink: { template: "<a><slot /></a>" },
          ExportDialog: true,
        },
      },
    });
    await flushPromises();
    state.api.mockRejectedValueOnce(new Error("仓库更新失败"));
    await controller.loadStock();

    expect(controller.error.value).toBe("仓库更新失败");
    expect(controller.detail.value.stock_preview[0].item_name).toBe("原有库存");
    expect(controller.detail.value.movements[0].item_name).toBe("原有动态");
    expect(controller.stockLoading.value).toBe(false);
    expect(controller.movementsLoading.value).toBe(false);

    state.api.mockResolvedValueOnce(makeDetail("重试库存", "重试动态"));
    await controller.retry();
    expect(controller.error.value).toBe("");
    expect(controller.detail.value.stock_preview[0].item_name).toBe("重试库存");
    expect(controller.detail.value.movements[0].item_name).toBe("重试动态");
    wrapper.unmount();
  });
});
