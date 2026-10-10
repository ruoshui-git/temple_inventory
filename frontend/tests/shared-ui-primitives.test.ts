import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AsyncImage from "../src/components/AsyncImage.vue";
import PageActionMenu from "../src/components/PageActionMenu.vue";
import ResultCountStrip from "../src/components/ResultCountStrip.vue";
import MovementLocation from "../src/components/MovementLocation.vue";
import MovementFlow from "../src/components/MovementFlow.vue";
import ExpiryCardGrid from "../src/components/ExpiryCardGrid.vue";

describe("AsyncImage", () => {
  it("shows a sized skeleton until the image loads", async () => {
    const wrapper = mount(AsyncImage, {
      props: { src: "/item.jpg", alt: "物品", width: 64, height: 48 },
    });

    expect(wrapper.classes()).toContain("async-image--loading");
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.get(".async-image__skeleton").exists()).toBe(true);
    expect(wrapper.get("img").attributes("width")).toBe("64");
    expect(wrapper.get("img").attributes("height")).toBe("48");

    await wrapper.get("img").trigger("load");
    expect(wrapper.classes()).toContain("async-image--loaded");
    expect(wrapper.find(".async-image__skeleton").exists()).toBe(false);
  });

  it("resets to loading when the source changes and exposes an error fallback", async () => {
    const wrapper = mount(AsyncImage, {
      props: { src: "/first.jpg", alt: "物品", placeholderLabel: "图片不可用" },
    });
    await wrapper.get("img").trigger("error");
    expect(wrapper.classes()).toContain("async-image--error");
    expect(wrapper.text()).toContain("图片不可用");

    await wrapper.setProps({ src: "/second.jpg" });
    expect(wrapper.classes()).toContain("async-image--loading");
    expect(wrapper.get(".async-image__skeleton").exists()).toBe(true);
  });

  it("uses a stable empty fallback without attempting an empty request", () => {
    const wrapper = mount(AsyncImage, { props: { src: "", alt: "物品" } });
    expect(wrapper.classes()).toContain("async-image--empty");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.get(".async-image__fallback").text()).toContain("暂无图片");
  });

  it("normalizes numeric string dimensions for correctly sized skeletons", () => {
    const wrapper = mount(AsyncImage, {
      props: { src: "/item.jpg", alt: "物品", width: "52", height: "52" },
    });
    expect(wrapper.attributes("style")).toContain("width: 52px");
    expect(wrapper.attributes("style")).toContain("height: 52px");
  });
});

describe("MovementLocation", () => {
  it("uses short accented labels for system warehouses and breadcrumbs for regular ones", () => {
    const system = mount(MovementLocation, {
      props: {
        name: "损坏待处理 - TCO",
        rows: [
          {
            name: "损坏待处理 - TCO",
            warehouse_name: "损坏待处理",
            breadcrumb: "损坏待处理",
            is_system: true,
          },
        ],
      },
    });
    expect(system.text()).toBe("◆ 损坏待处理");
    expect(system.classes()).toContain("movement-location-system");

    const regular = mount(MovementLocation, {
      props: {
        name: "A02 - TCO",
        rows: [{ name: "A02 - TCO", breadcrumb: "第2寺院 / A02" }],
      },
    });
    expect(regular.text()).toBe("第2寺院 / A02");
    expect(regular.classes()).not.toContain("movement-location-system");
  });
});

describe("ResultCountStrip", () => {
  it("renders the shared complete-result contract and update state", () => {
    const wrapper = mount(ResultCountStrip, {
      props: { loaded: 7, filtered: 12, overall: 23, updating: true },
    });
    expect(wrapper.text()).toContain("已加载 7 · 筛选结果 12 · 全部 23");
    expect(wrapper.text()).toContain("正在更新…");
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });

  it("keeps browse filters before the right-aligned count in narrow layout markup", () => {
    const wrapper = mount({
      components: { ResultCountStrip },
      template: `<div class="browse-result-meta">
				<div class="active-filter-chips">筛选：食品</div>
				<ResultCountStrip :loaded="2" :filtered="2" :overall="4" />
			</div>`,
    });
    const children = wrapper.get(".browse-result-meta").element.children;
    expect(children[0].classList.contains("active-filter-chips")).toBe(true);
    expect(children[1].classList.contains("result-count-strip")).toBe(true);
  });
});

describe("browse presentation", () => {
  it("keeps the Expiry batch visible once and retains location details", () => {
    const wrapper = mount(ExpiryCardGrid, {
      props: {
        rows: [
          {
            batch_no: "B-001",
            item_code: "ITM-1",
            item_name: "样例物品",
            item_group: "类别",
            stock_uom: "Nos",
            total_qty: 3,
            expiry_date: "2027-01-01",
            locations: [{ warehouse: "WH-1", qty: 3 }],
          },
        ],
      },
    });
    const text = wrapper.text();
    expect(text.match(/批次 B-001/g)?.length).toBe(1);
    expect(text).toContain("1 个库位");
    expect(text).not.toContain("批次信息");
  });

  it("renders operation records as independent warehouse branches", () => {
    const wrapper = mount(MovementFlow, {
      props: {
        row: {
          warehouse_flows: [
            {
              source_warehouse: "LOAN",
              destination_warehouse: "WH-A",
              line_count: 2,
              quantities: [{ uom: "Nos", qty: 3 }],
            },
            {
              source_warehouse: "LOAN",
              destination_warehouse: "DAMAGED",
              line_count: 1,
              quantities: [{ uom: "Nos", qty: 1 }],
            },
          ],
        },
        rows: [
          { name: "LOAN", warehouse_name: "借出", is_system: true },
          { name: "WH-A", breadcrumb: "样例库位一" },
          { name: "DAMAGED", warehouse_name: "损坏待处理", is_system: true },
        ],
      },
    });
    expect(wrapper.findAll(".movement-flow-branch")).toHaveLength(2);
    expect(wrapper.text()).toContain("3 Nos");
    expect(wrapper.text()).toContain("1 Nos");
  });
});

describe("PageActionMenu", () => {
  const actions = [
    { kind: "Receive", label: "入库", icon: "box" },
    { kind: "Loan", label: "借出", disabled: true },
    { kind: "Return", label: "归还", loading: true },
    { kind: "Issue", label: "出库" },
  ];

  it("supports keyboard navigation, disabled actions, selection and focus restoration", async () => {
    const wrapper = mount(PageActionMenu, {
      attachTo: document.body,
      props: { actions, label: "新增记录" },
    });
    const trigger = wrapper.get<HTMLButtonElement>(
      ".page-action-menu__trigger",
    );
    await trigger.trigger("click");
    await flushPromises();
    const items = wrapper.findAll<HTMLButtonElement>('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0].element);
    expect(items[1].element.disabled).toBe(true);
    expect(items[2].element.disabled).toBe(true);
    await items[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[3].element);
    await items[3].trigger("click");
    expect(wrapper.emitted("select")).toEqual([["Issue"]]);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("closes on outside pointer, Escape, focus leaving, and does not open when disabled", async () => {
    const wrapper = mount(PageActionMenu, {
      attachTo: document.body,
      props: { actions: [{ kind: "Receive", label: "入库" }] },
    });
    const trigger = wrapper.get<HTMLButtonElement>(
      ".page-action-menu__trigger",
    );
    await trigger.trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    await trigger.trigger("click");
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    await trigger.trigger("click");
    await trigger.trigger("focusout", { relatedTarget: document.body });
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    await wrapper.setProps({ disabled: true });
    await trigger.trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
