// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import ItemImage from "../src/components/ItemImage.vue";
import { useBrowseSelection } from "../src/composables/useBrowseSelection";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("ItemImage in browse selection mode", () => {
  it("renders an inert framed image and lets the thumbnail click reach its row", async () => {
    let selection!: ReturnType<typeof useBrowseSelection>;
    const wrapper = mount(
      defineComponent({
        setup() {
          selection = useBrowseSelection();
          selection.enter();
          return () =>
            h(
              "article",
              { onClick: () => selection.toggle("ITEM-1") },
              h(ItemImage, {
                item: { code: "ITEM-1", name: "法器", image: "/photo.jpg" },
                interaction: "detail",
                frame: true,
              }),
            );
        },
      }),
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".item-image").exists()).toBe(true);
    expect(wrapper.find(".item-image-detail").exists()).toBe(false);
    expect(wrapper.find(".item-image-enlarge").exists()).toBe(false);
    expect(wrapper.find(".item-image-button").exists()).toBe(false);
    await wrapper.get("article").get(".item-image").trigger("click");
    expect(selection.selected.value).toEqual(["ITEM-1"]);
    expect(wrapper.find("[role='dialog']").exists()).toBe(false);
  });
});
