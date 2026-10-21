import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AsyncImage from "../src/components/ui/AsyncImage.vue";
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
    expect(wrapper.attributes("style")).toContain("aspect-ratio: 1");
    expect(wrapper.attributes("style")).not.toContain("height: 48px");

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
    expect(wrapper.text()).toContain("图片加载失败");

    await wrapper.setProps({ src: "/second.jpg" });
    expect(wrapper.classes()).toContain("async-image--loading");
    expect(wrapper.get(".async-image__skeleton").exists()).toBe(true);
  });

  it("uses a stable empty fallback without attempting an empty request", () => {
    const wrapper = mount(AsyncImage, { props: { src: "", alt: "物品" } });
    expect(wrapper.classes()).toContain("async-image--empty");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.get(".async-image__fallback").text()).toContain("暂无图片");
    expect(wrapper.get(".async-image__placeholder").attributes("viewBox")).toBe(
      "0 0 32 32",
    );
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe("物品");
  });

  it("normalizes numeric string dimensions for correctly sized skeletons", () => {
    const wrapper = mount(AsyncImage, {
      props: { src: "/item.jpg", alt: "物品", width: "52", height: "52" },
    });
    expect(wrapper.attributes("style")).toContain("width: 52px");
    expect(wrapper.attributes("style")).toContain("aspect-ratio: 1");
  });
});
