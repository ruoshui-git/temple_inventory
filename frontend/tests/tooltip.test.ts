// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, withDirectives } from "vue";
import IconButton from "../src/components/ui/IconButton.vue";
import Overlay from "../src/components/ui/Overlay.vue";
import TooltipHost from "../src/components/ui/TooltipHost.vue";
import UiButton from "../src/components/ui/UiButton.vue";
import { vTip } from "../src/directives/tip";
import { tooltipId, type TooltipValue } from "../src/lib/tooltip";

const mounted: VueWrapper[] = [];
const tooltip = () => document.getElementById(tooltipId)!;
const visible = () => tooltip().style.display !== "none";
const trigger = (
  id: string,
  value: TooltipValue,
  extra = {},
  overflow = false,
) =>
  withDirectives(h("button", { id, ...extra }, id), [
    [vTip, value, undefined, { overflow }],
  ]);
function fixture(render: () => ReturnType<typeof h>) {
  const Host = defineComponent({
    setup: () => () => h("section", [h(TooltipHost), render()]),
  });
  const wrapper = mount(Host, { attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}
function pointer(target: Element, event: string, init: PointerEventInit = {}) {
  target.dispatchEvent(
    new PointerEvent(event, {
      bubbles: true,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      ...init,
    }),
  );
}
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await nextTick();
}
function escape(target: HTMLElement) {
  return target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }),
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  history.replaceState(null, "", location.pathname);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("shared tooltip", () => {
  it("delays initial mouse hover, lets the pointer cross the gap, and opens another immediately", async () => {
    const root = fixture(() =>
      h("div", [trigger("one", { text: "文字" }), trigger("two", "另一个")]),
    );
    const first = root.get("#one").element;
    const second = root.get("#two").element;
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    pointer(first, "pointerover");
    await tick(119);
    expect(visible()).toBe(false);
    await tick(1);
    expect(tooltip().textContent).toBe("文字");
    pointer(first, "pointerout");
    await tick(55);
    pointer(tooltip(), "pointerover");
    await tick(150);
    expect(visible()).toBe(true);
    pointer(tooltip(), "pointerout");
    await tick(100);
    expect(visible()).toBe(false);
    pointer(second, "pointerover");
    await nextTick();
    expect(tooltip().textContent).toBe("另一个");
    pointer(second, "pointerout");
    await tick(401);
    pointer(first, "pointerover", { pointerType: "pen" });
    await tick(119);
    expect(visible()).toBe(false);
    await tick(1);
    expect(visible()).toBe(true);
  });

  it("describes keyboard focus, preserves other descriptions and deduplicates the accessible name", async () => {
    const root = fixture(() =>
      h("div", [
        trigger("one", "A <b>detail</b>", {
          "aria-describedby": "form-help other",
        }),
        trigger("two", "same name", { "aria-labelledby": "named" }),
        h("p", { id: "named" }, "same name"),
      ]),
    );
    const first = root.get<HTMLButtonElement>("#one").element;
    const second = root.get<HTMLButtonElement>("#two").element;
    const firstMatches = vi.spyOn(first, "matches").mockReturnValue(false);
    first.focus();
    await nextTick();
    expect(visible()).toBe(false);
    first.blur();
    firstMatches.mockReturnValue(true);
    first.focus();
    await nextTick();
    expect(visible()).toBe(true);
    expect(tooltip().textContent).toBe("A <b>detail</b>");
    expect(tooltip().querySelector("b")).toBeNull();
    expect(first.getAttribute("aria-describedby")).toBe(
      `form-help other ${tooltipId}`,
    );
    first.setAttribute("aria-describedby", "new-help");
    await nextTick();
    expect(first.getAttribute("aria-describedby")).toBe(
      `new-help ${tooltipId}`,
    );
    expect(escape(first)).toBe(false);
    expect(first.getAttribute("aria-describedby")).toBe("new-help");
    vi.spyOn(second, "matches").mockReturnValue(true);
    second.focus();
    await nextTick();
    expect(visible()).toBe(true);
    expect(second.hasAttribute("aria-describedby")).toBe(false);
  });

  it("uses the first Escape for the tooltip and the next Escape for a real overlay", async () => {
    const close = vi.fn();
    fixture(() =>
      h(
        Overlay,
        { title: "Dialog", onClose: close },
        {
          default: () => trigger("inside", "detail"),
        },
      ),
    );
    await flushPromises();
    const button = document.getElementById("inside")!;
    pointer(button, "pointerover");
    await tick(120);
    expect(tooltip().parentElement).toBe(document.body);
    expect(escape(button)).toBe(false);
    await nextTick();
    expect(visible()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    escape(button);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("holds on touch, suppresses just the post-hold click, and cancels on movement or scroll", async () => {
    const select = vi.fn();
    const root = fixture(() =>
      trigger("touch", "touch detail", { onClick: select }),
    );
    const button = root.get("#touch").element;
    const touch = { pointerType: "touch" };
    const click = () =>
      button.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
        }),
      );
    pointer(button, "pointerover", touch);
    await tick(500);
    expect(visible()).toBe(false);
    pointer(button, "pointerdown", touch);
    await tick(449);
    expect(visible()).toBe(false);
    await tick(1);
    expect(visible()).toBe(true);
    pointer(button, "pointerup", touch);
    expect(click()).toBe(false);
    expect(select).not.toHaveBeenCalled();
    pointer(button, "pointerdown", touch);
    pointer(button, "pointerup", touch);
    expect(click()).toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
    pointer(button, "pointerdown", touch);
    pointer(button, "pointermove", { ...touch, clientX: 9 });
    await tick(450);
    expect(visible()).toBe(false);
    pointer(button, "pointerdown", touch);
    document.dispatchEvent(new Event("scroll"));
    await tick(450);
    expect(visible()).toBe(false);
    pointer(button, "pointerdown", touch);
    await tick(450);
    pointer(document.body, "pointerdown", touch);
    await nextTick();
    expect(visible()).toBe(false);
  });

  it("only opens overflow tips for clipped content and closes on navigation, blur and detach", async () => {
    const label = ref("Full label");
    const root = fixture(() =>
      trigger(
        "overflow",
        label.value,
        { style: { overflowX: "hidden" } },
        true,
      ),
    );
    const anchor = root.get("#overflow").element;
    Object.defineProperties(anchor, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 100, configurable: true },
    });
    pointer(anchor, "pointerover");
    await tick(120);
    expect(visible()).toBe(false);
    Object.defineProperty(anchor, "scrollWidth", { value: 104 });
    pointer(anchor, "pointerover");
    await tick(120);
    expect(visible()).toBe(true);
    label.value = "Updated";
    await nextTick();
    expect(tooltip().textContent).toBe("Updated");
    document.dispatchEvent(new Event("inventory-navigation"));
    await nextTick();
    expect(visible()).toBe(false);
    pointer(anchor, "pointerover");
    await nextTick();
    window.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(visible()).toBe(false);
    pointer(anchor, "pointerover");
    await nextTick();
    anchor.remove();
    await flushPromises();
    expect(visible()).toBe(false);
    expect(anchor.hasAttribute("aria-describedby")).toBe(false);
  });

  it.each([UiButton, IconButton])(
    "shows disabled reasons on a focusable wrapper",
    async (Button) => {
      const root = fixture(() =>
        h(
          Button,
          { disabled: true, title: "不可删除", label: "删除" },
          {
            default: () => "删除",
          },
        ),
      );
      const button = root.get("button");
      const wrapper = root.get(".disabled-button-tip");
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.attributes("title")).toBeUndefined();
      expect(wrapper.attributes("tabindex")).toBe("0");
      pointer(wrapper.element, "pointerover");
      await tick(120);
      expect(tooltip().textContent).toBe("不可删除");
      expect(wrapper.attributes("aria-describedby")).toBe(tooltipId);
      pointer(wrapper.element, "pointerdown");
      await nextTick();
      expect(visible()).toBe(false);
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      vi.spyOn(wrapper.element, "matches").mockReturnValue(true);
      (wrapper.element as HTMLElement).focus();
      await nextTick();
      expect(visible()).toBe(true);
    },
  );
});
