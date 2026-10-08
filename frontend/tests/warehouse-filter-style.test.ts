import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Warehouses from "../src/pages/Warehouses.vue";

const state = vi.hoisted(() => ({
  api: vi.fn(),
  router: { currentRoute: { value: { query: {} } }, push: vi.fn() },
}));
vi.mock("vue-router", () => ({ useRouter: () => state.router }));
vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<any>("../src/lib/api");
  return { ...actual, api: state.api };
});

describe("warehouse search compact visual contract", () => {
  beforeEach(() => {
    state.api.mockReset().mockResolvedValue({
      physical_tree: [],
      is_manager: false,
      settings: {},
    });
  });
  it("keeps one search surface and uses compact search styling", async () => {
    const wrapper = mount(Warehouses);
    await flushPromises();
    expect(wrapper.findAll(".warehouse-search")).toHaveLength(1);
    expect(wrapper.find(".compact-search-field input").attributes("type")).toBe(
      "search",
    );
  });
});
