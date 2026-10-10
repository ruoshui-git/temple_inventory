import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MobileExpiryResults from "../src/components/MobileExpiryResults.vue";

const row = {
  batch_no: "B-1",
  item_code: "A-1",
  item_name: "物品",
  item_group: "类别",
  stock_uom: "Nos",
  total_qty: 2,
  locations: [],
};

describe("MobileExpiryResults", () => {
  it("exposes loading, append, error/retry, and empty states", async () => {
    const loading = mount(MobileExpiryResults, {
      props: { rows: [], loading: true },
    });
    expect(loading.text()).toContain("正在加载记录");
    const appending = mount(MobileExpiryResults, {
      props: { rows: [row], loadingMore: true },
    });
    expect(appending.text()).toContain("正在加载更多记录");
    const error = mount(MobileExpiryResults, {
      props: { rows: [], error: "加载失败" },
    });
    expect(error.text()).toContain("加载失败");
    await error.find("button").trigger("click");
    expect(error.emitted("retry")).toHaveLength(1);
    const empty = mount(MobileExpiryResults, { props: { rows: [] } });
    expect(empty.text()).toContain("暂无符合条件的批次");
  });

  it("keeps batch/location chips outside row activation and marks expired locations", async () => {
    const wrapper = mount(MobileExpiryResults, {
      attachTo: document.body,
      props: {
        rows: [
          {
            ...row,
            days_to_expiry: -3,
            expiry_date: "2026-01-01",
            locations: [{ warehouse: "库位 A", qty: 2 }],
          },
        ],
      },
    });
    const chips = wrapper.findAll(".detail-popover-trigger");
    expect(chips).toHaveLength(2);
    await chips[1].trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.textContent).toContain("已过期");
    expect(wrapper.emitted("activate")).toBeUndefined();
    await wrapper.find(".mobile-expiry-result-row").trigger("click");
    expect(wrapper.emitted("activate")).toHaveLength(1);
    wrapper.unmount();
  });
});
