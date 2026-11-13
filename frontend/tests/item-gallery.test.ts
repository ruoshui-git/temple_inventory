// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ItemGallery from "../src/components/ItemGallery.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("ItemGallery", () => {
  it("keeps a framed shared missing-image state when no image exists", () => {
    const wrapper = mount(ItemGallery, {
      props: {
        item: {
          code: "ITEM-EMPTY",
          name: "无图物品",
          category: "",
          uom: "个",
          image: "",
          tracksBatch: false,
          tracksExpiry: false,
          locations: [],
          available: 0,
          loaned: 0,
          damaged: 0,
        },
        attachments: [],
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".item-gallery-hero .item-image--frame").exists()).toBe(
      true,
    );
    expect(wrapper.find(".item-gallery-thumbs").exists()).toBe(false);
  });

  it("selects image thumbnails by click and keyboard, and opens a navigable lightbox", async () => {
    const wrapper = mount(ItemGallery, {
      props: {
        item: {
          code: "ITEM-A",
          name: "铜磬",
          category: "法器",
          uom: "个",
          image: "/private/main.jpg",
          tracksBatch: false,
          tracksExpiry: false,
          locations: [],
          available: 0,
          loaned: 0,
          damaged: 0,
        },
        attachments: [
          {
            id: "FILE-A",
            name: "侧面.jpg",
            type: "image/jpeg",
            url: "/private/side.jpg",
            primary: false,
            state: "ready",
            progress: 100,
            error: "",
          },
        ],
      },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const thumbs = wrapper.findAll('[role="option"]');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]?.attributes("aria-selected")).toBe("true");
    await thumbs[0]?.trigger("keydown", { key: "ArrowRight" });
    expect(thumbs[1]?.attributes("aria-selected")).toBe("true");
    await thumbs[1]?.trigger("click");
    expect(thumbs[1]?.attributes("aria-selected")).toBe("true");
    const hero = wrapper.get(".item-gallery-hero").element;
    const pointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(pointerDown, "clientX", { value: 200 });
    hero.dispatchEvent(pointerDown);
    const pointerUp = new Event("pointerup", { bubbles: true });
    Object.defineProperty(pointerUp, "clientX", { value: 100 });
    hero.dispatchEvent(pointerUp);
    await wrapper.get(".item-gallery-hero").trigger("click");
    expect(thumbs[0]?.attributes("aria-selected")).toBe("true");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await wrapper
      .get(".item-gallery-hero")
      .trigger("keydown", { key: "ArrowLeft" });
    expect(thumbs[1]?.attributes("aria-selected")).toBe("true");
    await wrapper
      .get(".item-gallery-hero")
      .trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="下一张"]')
      ?.click();
    await flushPromises();
    expect(document.body.textContent).toContain("1 / 2");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await flushPromises();
    expect(document.body.textContent).toContain("2 / 2");
  });
});
