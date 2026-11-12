// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import DateField from "../src/components/ui/DateField.vue";
import Overlay from "../src/components/ui/Overlay.vue";
import DataTable from "../src/components/ui/DataTable.vue";
import { getColumnWidths, preferenceUser } from "../src/lib/uiPreferences";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.head.querySelector("style[data-overlay-exit-test]")?.remove();
  localStorage.clear();
  preferenceUser.value = "";
  vi.restoreAllMocks();
});

describe("shared desktop UI controls", () => {
  it("keeps DateField native and forwards value bounds and clear", async () => {
    const wrapper = mount(DateField, {
      props: {
        modelValue: "2026-11-01",
        min: "2026-01-01",
        max: "2026-12-31",
        clearable: true,
      },
    });
    wrappers.push(wrapper);
    const input = wrapper.get('input[type="date"]');
    expect(input.element.getAttribute("min")).toBe("2026-01-01");
    expect(input.element.getAttribute("max")).toBe("2026-12-31");
    await input.setValue("2026-11-12");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      "2026-11-12",
    ]);
    await wrapper.get(".date-field-clear").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });

  it("uses Enter for an enabled dialog primary action and Escape to close", async () => {
    const wrapper = mount(Overlay, {
      attachTo: document.body,
      props: { title: "Test" },
      slots: {
        footer: '<button class="ui-button ui-button--primary">Save</button>',
      },
    });
    wrappers.push(wrapper);
    await nextTick();
    const primary = document.querySelector<HTMLButtonElement>(
      ".ui-dialog .ui-button--primary",
    )!;
    const click = vi.spyOn(primary, "click");
    primary.focus();
    primary.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(click).not.toHaveBeenCalled();
    const input = document.createElement("input");
    document.querySelector(".dialog-content")!.append(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(click).toHaveBeenCalledOnce();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("does not activate a disabled dialog primary action on Enter", async () => {
    const wrapper = mount(Overlay, {
      attachTo: document.body,
      props: { title: "Test" },
      slots: {
        footer:
          '<button class="ui-button ui-button--primary" disabled>Save</button>',
      },
    });
    wrappers.push(wrapper);
    await nextTick();
    const primary = document.querySelector<HTMLButtonElement>(
      ".ui-dialog .ui-button--primary",
    )!;
    const click = vi.spyOn(primary, "click");
    const input = document.createElement("input");
    document.querySelector(".dialog-content")!.append(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("keeps the overlay mounted through exit and returns focus to its invoker", async () => {
    document.head.insertAdjacentHTML(
      "beforeend",
      "<style data-overlay-exit-test>.overlay-leave-active{transition:opacity 60ms linear}.overlay-leave-to{opacity:0}</style>",
    );
    const invoker = document.createElement("button");
    invoker.textContent = "Open";
    document.body.append(invoker);
    invoker.focus();
    const visible = ref(true);
    const host = defineComponent({
      setup() {
        return () =>
          h("div", [
            invoker,
            visible.value ? h(Overlay, { title: "Exit" }) : null,
          ]);
      },
    });
    const wrapper = mount(host, { attachTo: document.body });
    wrappers.push(wrapper);
    await nextTick();
    visible.value = false;
    await nextTick();
    const exitFrame = document.querySelector<HTMLElement>(
      ".overlay-exit-frame",
    );
    expect(exitFrame?.shadowRoot?.querySelector(".ui-dialog")).toBeTruthy();
    expect(document.activeElement).toBe(invoker);
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(document.querySelector(".overlay-exit-frame")).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it("resizes a column with the keyboard, persists width, and does not sort", async () => {
    preferenceUser.value = "test-account";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    const wrapper = mount(DataTable, {
      props: {
        ariaLabel: "Resize test",
        columns: [{ id: "name", label: "Name", sortable: true }],
        rows: [{ id: "row-1", kind: "record", value: { name: "Row" } }],
      },
    });
    wrappers.push(wrapper);
    await nextTick();
    const separator = wrapper.get('[role="separator"]');
    await separator.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("sort")).toBeUndefined();
    expect(getColumnWidths("test-account", "Resize test:name").name).toBe(
      Number(separator.attributes("aria-valuenow")),
    );
    expect(separator.attributes("aria-orientation")).toBe("vertical");
  });
});
