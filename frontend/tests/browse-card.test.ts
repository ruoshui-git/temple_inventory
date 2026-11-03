// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import BrowseCard from "../src/components/ui/BrowseCard.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("BrowseCard", () => {
  it("toggles on row activation and keyboard while selecting", async () => {
    const wrapper = mount(BrowseCard, {
      props: {
        rowKey: "ITEM-1",
        selecting: true,
        selected: false,
        selectLabel: "选择法器",
        variant: "card",
      },
      slots: { default: "卡片标题" },
    });
    wrappers.push(wrapper);
    const card = wrapper.get("[data-browse-row='ITEM-1']");
    expect(card.attributes("role")).toBe("checkbox");
    expect(card.attributes("aria-checked")).toBe("false");
    expect(card.attributes("tabindex")).toBe("0");
    expect(wrapper.find(".card-checkbox input").exists()).toBe(true);
    await card.trigger("click");
    await card.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("toggle")).toHaveLength(2);
  });

  it("keeps a field line's 更多 button from opening the row", async () => {
    const wrapper = mount(BrowseCard, {
      props: {
        rowKey: "ITEM-3",
        selecting: false,
        selected: false,
        selectLabel: "选择法器",
        variant: "row",
      },
      slots: {
        default: () => h("button", { class: "card-fields-more" }, "+2 项"),
      },
    });
    wrappers.push(wrapper);
    await wrapper.get("button.card-fields-more").trigger("click");
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("opens ordinary cards, ignores nested buttons, and exposes title activation", async () => {
    const wrapper = mount(BrowseCard, {
      props: {
        rowKey: "ITEM-2",
        selecting: false,
        selected: false,
        selectLabel: "选择法器",
        variant: "row",
      },
      slots: {
        default: ({ activate }: { activate: (event: MouseEvent) => void }) => [
          h("button", { onClick: activate }, "title"),
          h("button", "other"),
        ],
      },
    });
    wrappers.push(wrapper);
    await wrapper.get("[data-browse-row='ITEM-2']").trigger("click");
    await wrapper.findAll("button")[1].trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    await wrapper.findAll("button")[0].trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(2);
  });
});
