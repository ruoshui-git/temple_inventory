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
    expect(loading.text()).toContain("正在更新记录");
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
});
