// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GroupTotals from "../src/components/ui/GroupTotals.vue";
import { setUnitSource } from "../src/lib/units";

const metrics = [
  {
    key: "available",
    label: "可用",
    entries: [
      { uom: "Box", qty: 3 },
      { uom: "Nos", qty: 12 },
    ],
  },
  { key: "loaned", label: "借出", entries: [{ uom: "Nos", qty: 1 }] },
  { key: "damaged", label: "损坏", entries: [{ uom: "Nos", qty: 0 }] },
  { key: "stock_qty", label: "合计", entries: [{ uom: "Nos", qty: 13 }] },
];

describe("GroupTotals", () => {
  beforeEach(() => {
    setUnitSource({
      units: [
        { name: "Nos", label: "个" },
        { name: "Box", label: "箱" },
      ],
    });
  });
  afterEach(() => setUnitSource(undefined));

  it("shows one value per non-zero metric up to max, in unit order", () => {
    const wrapper = mount(GroupTotals, { props: { metrics } });
    const values = wrapper.findAll(".group-totals-value").map((v) => v.text());
    expect(values).toEqual(["可用 12 个", "借出 1 个"]);
    expect(wrapper.text()).toContain("可用 12 个 · 借出 1 个");
  });

  it("skips all-zero metrics inline", () => {
    const wrapper = mount(GroupTotals, {
      props: {
        metrics: [
          { key: "damaged", label: "损坏", entries: [{ uom: "Nos", qty: 0 }] },
          { key: "loaned", label: "借出", entries: [{ uom: "Nos", qty: 4 }] },
        ],
      },
    });
    expect(wrapper.findAll(".group-totals-value").map((v) => v.text())).toEqual(
      ["借出 4 个"],
    );
    expect(wrapper.find(".group-totals-more").exists()).toBe(false);
  });

  it("counts every hidden non-zero unit and metric in the +N disclosure", () => {
    const wrapper = mount(GroupTotals, { props: { metrics } });
    // Non-zero values: 3 箱, 12 个, 1 个, 13 个 = 4; two are shown inline.
    expect(wrapper.get(".group-totals-more").text()).toBe("+2");
  });

  it("lists every metric and unit in the popover", async () => {
    const wrapper = mount(GroupTotals, { props: { metrics } });
    await wrapper.get(".group-totals-more button").trigger("click");
    const panel = document.querySelector(".detail-popover-content");
    expect(panel).not.toBeNull();
    const rows = Array.from(panel!.querySelectorAll("li")).map(
      (li) => li.textContent,
    );
    expect(rows).toEqual([
      "可用：12 个；3 箱",
      "借出：1 个",
      "损坏：0 个",
      "合计：13 个",
    ]);
    wrapper.unmount();
  });

  it("falls back to the first metric's first value when every value is zero", () => {
    const wrapper = mount(GroupTotals, {
      props: {
        metrics: [
          {
            key: "available",
            label: "可用",
            entries: [{ uom: "Nos", qty: 0 }],
          },
          { key: "loaned", label: "借出", entries: [{ uom: "Nos", qty: 0 }] },
        ],
      },
    });
    expect(wrapper.findAll(".group-totals-value").map((v) => v.text())).toEqual(
      ["可用 0 个"],
    );
    expect(wrapper.find(".group-totals-more").exists()).toBe(false);
  });

  it("formats signed metrics with + and − and unsigned negatives with −", () => {
    const wrapper = mount(GroupTotals, {
      props: {
        metrics: [
          {
            key: "effect",
            label: "可用变化",
            signed: true,
            entries: [
              { uom: "Nos", qty: 4 },
              { uom: "Box", qty: -2 },
            ],
          },
          {
            key: "loaned",
            label: "借出",
            entries: [{ uom: "Nos", qty: -5 }],
          },
        ],
      },
    });
    expect(wrapper.findAll(".group-totals-value").map((v) => v.text())).toEqual(
      ["可用变化 +4 个", "借出 −5 个"],
    );
    expect(wrapper.attributes("aria-label")).toBe(
      "分组数量：可用变化：+4 个；−2 箱 · 借出：−5 个",
    );
    expect(wrapper.attributes("title")).toBe(
      "可用变化：+4 个；−2 箱 · 借出：−5 个",
    );
  });

  it("gives spare inline slots to more units once every metric shows one", () => {
    const wrapper = mount(GroupTotals, {
      props: {
        metrics: [
          {
            key: "effect",
            label: "可用变化",
            signed: true,
            entries: [
              { uom: "Nos", qty: 4 },
              { uom: "Box", qty: -2 },
              { uom: "Kg", qty: 1 },
            ],
          },
        ],
      },
    });
    expect(wrapper.findAll(".group-totals-value").map((v) => v.text())).toEqual(
      ["可用变化 +4 个；−2 箱"],
    );
    expect(wrapper.get(".group-totals-more").text()).toBe("+1");
  });
});
