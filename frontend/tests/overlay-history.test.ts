import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, type VueWrapper } from "vue";
import {
  flushPromises,
  mount,
  type VueWrapper as TestWrapper,
} from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import Overlay from "../src/components/ui/Overlay.vue";
import { installOverlayHistory } from "../src/lib/overlayHistory";

const wrappers: VueWrapper[] = [];
let disposeRouter: (() => void) | undefined;
let router: ReturnType<typeof createRouter> | undefined;
function openOverlay(props: Record<string, unknown> = {}) {
  const wrapper = mount(Overlay, {
    attachTo: document.body,
    props: { title: "测试对话框", ...props },
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(async () => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  await nextTick();
  disposeRouter?.();
  disposeRouter = undefined;
  router?.options.history.destroy();
  router = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  try {
    history.replaceState(null, "", location.pathname);
  } catch {
    // History may be unavailable in restricted test environments.
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.restoreAllMocks();
});

describe("Overlay history", () => {
  it("pushes a same-URL marker and closes on Back without changing the route", async () => {
    const wrapper = openOverlay();
    await wrapper.vm.$nextTick();
    expect((history.state as { tiOverlay?: string }).tiOverlay).toMatch(
      /^ti-overlay-/,
    );
    const marker = history.state;
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(location.pathname).toBe("/");
    expect(marker.tiOverlay).toBeTruthy();
  });

  it("programmatic close consumes only the current marker", async () => {
    vi.useFakeTimers();
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    const wrapper = openOverlay();
    await wrapper.vm.$nextTick();
    document.querySelector<HTMLElement>(".dialog-heading .ui-button")!.click();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    await vi.runAllTimersAsync();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("keeps a nondismissible overlay open when Back is pressed", async () => {
    const wrapper = openOverlay({ dismissible: false });
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(wrapper.emitted("close")).toBeUndefined();
    expect((history.state as { tiOverlay?: string }).tiOverlay).toMatch(
      /^ti-overlay-/,
    );
  });

  it("restores its marker when the close handler keeps it mounted", async () => {
    const wrapper = openOverlay();
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect((history.state as { tiOverlay?: string }).tiOverlay).toMatch(
      /^ti-overlay-/,
    );
  });

  it("replaces the overlay entry when an action starts router navigation", async () => {
    history.replaceState(null, "", "/beneath?prior=1");
    history.pushState(null, "", "/beneath");
    router = createRouter({
      history: createWebHistory("/"),
      routes: [
        { path: "/beneath", component: { render: () => h("div", "beneath") } },
        { path: "/editor", component: { render: () => h("div", "editor") } },
      ],
    });
    await router.push("/beneath");
    await router.isReady();
    disposeRouter = installOverlayHistory(router);
    const showing = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          showing.value
            ? h(
                Overlay,
                { title: "新建", onClose: () => (showing.value = false) },
                {
                  default: () =>
                    h(
                      "button",
                      {
                        onClick: () => {
                          document.dispatchEvent(
                            new Event("inventory-navigation"),
                          );
                          void router!.push("/editor");
                          showing.value = false;
                        },
                      },
                      "入库",
                    ),
                },
              )
            : null;
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    wrappers.push(wrapper as TestWrapper);
    await nextTick();
    const editorNavigation = new Promise<void>((resolve) => {
      const remove = router!.afterEach((to) => {
        if (to.path === "/editor") {
          remove();
          resolve();
        }
      });
    });
    document
      .querySelector<HTMLElement>(".preview-dialog .dialog-content button")!
      .click();
    await editorNavigation;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/editor");
    expect(history.state?.tiOverlay).toBeUndefined();
    await router.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.pathname).toBe("/beneath");
  });
});
