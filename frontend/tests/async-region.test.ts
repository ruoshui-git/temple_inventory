import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import AsyncRegion from "../src/components/ui/AsyncRegion.vue";
import SkeletonBlock from "../src/components/ui/SkeletonBlock.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("AsyncRegion", () => {
  it("shows its skeleton before the first successful result", () => {
    const wrapper = mount(AsyncRegion, {
      props: { loading: true, initialized: false },
      slots: {
        skeleton: '<div class="test-skeleton">loading shape</div>',
        default: "<p>result</p>",
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".test-skeleton").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("result");
  });

  it("retains, dims and inerts initialized content during refresh", () => {
    const wrapper = mount(AsyncRegion, {
      props: {
        loading: true,
        initialized: true,
        stale: true,
        label: "刷新库存",
      },
      slots: { default: "<button>result action</button>" },
    });
    wrappers.push(wrapper);
    expect(wrapper.get(".async-result-region").classes()).toContain(
      "is-refreshing",
    );
    expect(
      wrapper.get(".async-result-region").attributes("inert"),
    ).toBeDefined();
    expect(wrapper.get('[role="status"]').text()).toBe("刷新库存");
    expect(wrapper.text()).toContain("result action");
  });

  it("does not show a skeleton after an initial request fails", () => {
    const wrapper = mount(AsyncRegion, {
      props: { loading: false, initialized: false, error: "request failed" },
      slots: {
        skeleton: "<div class='skeleton'>loading</div>",
        error: "<p>failed</p>",
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toBe("failed");
  });
});

describe("SkeletonBlock", () => {
  it("renders the requested number of lines", () => {
    const wrapper = mount(SkeletonBlock, {
      props: { variant: "lines", count: 4 },
    });
    wrappers.push(wrapper);
    expect(wrapper.findAll(".skeleton-block__line")).toHaveLength(4);
    expect(wrapper.attributes("aria-hidden")).toBe("true");
  });

  it.each(["card", "list", "detail"] as const)(
    "renders the %s shape",
    (variant) => {
      const wrapper = mount(SkeletonBlock, { props: { variant, rows: 3 } });
      wrappers.push(wrapper);
      expect(wrapper.classes()).toContain(`skeleton-block--${variant}`);
      expect(wrapper.findAll(".skeleton").length).toBeGreaterThan(0);
    },
  );
});
