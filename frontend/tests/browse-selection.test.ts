// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, watch } from "vue";
import { useBrowseSelection } from "../src/composables/useBrowseSelection";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

describe("browse selection state", () => {
  it("enters, retains loaded keys, clears on Escape and exits selection mode", async () => {
    let selection!: ReturnType<typeof useBrowseSelection>;
    const wrapper = mount(
      defineComponent({
        setup() {
          selection = useBrowseSelection();
          return () => h("div");
        },
      }),
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    selection.enter();
    selection.set("row-a", true);
    selection.set("row-b", true);
    selection.retain(["row-a"]);
    expect(selection.selecting.value).toBe(true);
    expect(selection.selected.value).toEqual(["row-a"]);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(selection.selecting.value).toBe(false);
    expect(selection.selected.value).toEqual([]);
  });

  it("clears selection when the controller account changes", async () => {
    const account = ref("volunteer");
    let selection!: ReturnType<typeof useBrowseSelection>;
    const wrapper = mount(
      defineComponent({
        setup() {
          selection = useBrowseSelection();
          watch(account, () => selection.exit());
          return () => h("div");
        },
      }),
    );
    wrappers.push(wrapper);
    selection.enter();
    selection.set("row-a", true);
    account.value = "manager";
    await nextTick();
    expect(selection.selecting.value).toBe(false);
    expect(selection.selected.value).toEqual([]);
  });
});
