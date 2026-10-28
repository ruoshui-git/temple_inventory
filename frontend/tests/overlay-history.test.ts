// @vitest-environment jsdom
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
  const historySyncRouter = createRouter({
    history: createWebHistory("/"),
    routes: [
      { path: "/:pathMatch(.*)*", component: { render: () => h("div") } },
    ],
  });
  const disposeHistorySync = installOverlayHistory(historySyncRouter);
  disposeHistorySync();
  historySyncRouter.options.history.destroy();
  const wrapper = mount(Overlay, {
    attachTo: document.body,
    props: { title: "测试对话框", ...props },
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.useFakeTimers();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  await nextTick();
  disposeRouter?.();
  disposeRouter = undefined;
  router?.options.history.destroy();
  router = undefined;
  document.body.innerHTML = "";
  try {
    history.replaceState(null, "", location.pathname);
  } catch {
    // History may be unavailable in restricted test environments.
  }
  await vi.runAllTimersAsync();
  vi.useRealTimers();
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

  it("hides a same-URL close popstate from Vue Router guards", async () => {
    history.replaceState(null, "", "/beneath");
    router = createRouter({
      history: createWebHistory("/"),
      routes: [
        { path: "/beneath", component: { render: () => h("div", "beneath") } },
        { path: "/editor", component: { render: () => h("div", "editor") } },
      ],
    });
    await router.push("/beneath");
    await router.isReady();
    const guard = vi.fn(() => false);
    router.beforeEach(guard);
    disposeRouter = installOverlayHistory(router);
    const showing = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          showing.value
            ? h(Overlay, {
                title: "确认",
                onClose: () => (showing.value = false),
              })
            : null;
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    wrappers.push(wrapper as TestWrapper);
    await nextTick();
    document.querySelector<HTMLElement>(".dialog-heading .ui-button")!.click();
    await vi.waitFor(() =>
      expect(router!.currentRoute.value.path).toBe("/beneath"),
    );
    await vi.waitFor(() => expect(history.state?.tiOverlay).toBeUndefined());
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/beneath");
    expect(guard).not.toHaveBeenCalled();
    expect(history.state?.tiOverlay).toBeUndefined();
  });

  it("hides a user Back that closes the overlay from Vue Router guards", async () => {
    history.replaceState(null, "", "/beneath");
    router = createRouter({
      history: createWebHistory("/"),
      routes: [
        { path: "/beneath", component: { render: () => h("div", "beneath") } },
      ],
    });
    await router.push("/beneath");
    await router.isReady();
    const guard = vi.fn(() => true);
    router.beforeEach(guard);
    disposeRouter = installOverlayHistory(router);
    const showing = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          showing.value
            ? h(Overlay, {
                title: "确认",
                onClose: () => (showing.value = false),
              })
            : null;
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    wrappers.push(wrapper as TestWrapper);
    await nextTick();
    history.back();
    await vi.waitFor(() =>
      expect(document.querySelector(".ui-overlay")).toBeNull(),
    );
    await vi.waitFor(() => expect(history.state?.tiOverlay).toBeUndefined());
    await flushPromises();
    expect(document.querySelector(".ui-overlay")).toBeNull();
    expect(router.currentRoute.value.path).toBe("/beneath");
    expect(guard).not.toHaveBeenCalled();
  });

  it("still sends a real cross-route Back through Vue Router guards", async () => {
    history.replaceState(null, "", "/beneath");
    router = createRouter({
      history: createWebHistory("/"),
      routes: [
        { path: "/beneath", component: { render: () => h("div", "beneath") } },
        { path: "/editor", component: { render: () => h("div", "editor") } },
      ],
    });
    await router.push("/beneath");
    await router.isReady();
    const guard = vi.fn(() => true);
    router.beforeEach(guard);
    disposeRouter = installOverlayHistory(router);
    await router.push("/editor");
    guard.mockClear();
    await router.back();
    await vi.waitFor(() =>
      expect(router!.currentRoute.value.path).toBe("/beneath"),
    );
    expect(router.currentRoute.value.path).toBe("/beneath");
    expect(guard).toHaveBeenCalled();
  });

  it("closes an overlay before a dirty editor's route leave guard runs", async () => {
    history.replaceState(null, "", "/list");
    const dirty = ref(false);
    const confirmLeave = vi.fn(() => false);
    router = createRouter({
      history: createWebHistory("/"),
      routes: [
        { path: "/list", component: { render: () => h("div", "list") } },
        { path: "/editor", component: { render: () => h("div", "editor") } },
      ],
    });
    await router.push("/list");
    await router.isReady();
    router.beforeEach((to, from) =>
      dirty.value && from.path === "/editor" ? confirmLeave() : true,
    );
    disposeRouter = installOverlayHistory(router);
    await router.push("/editor");
    dirty.value = true;
    confirmLeave.mockClear();

    const showing = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          showing.value
            ? h(Overlay, {
                title: "编辑选项",
                onClose: () => (showing.value = false),
              })
            : null;
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    wrappers.push(wrapper as TestWrapper);
    await nextTick();
    await vi.waitFor(() => expect(history.state?.tiOverlay).toBeDefined());

    window.history.back();
    await vi.waitFor(() =>
      expect(document.querySelector(".ui-overlay")).toBeNull(),
    );
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/editor");
    expect(confirmLeave).not.toHaveBeenCalled();

    window.history.back();
    await vi.waitFor(() => expect(confirmLeave).toHaveBeenCalledOnce());
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/editor");
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
      .querySelector<HTMLElement>(".ui-dialog .dialog-content button")!
      .click();
    await editorNavigation;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/editor");
    expect(history.state?.tiOverlay).toBeUndefined();
    await router.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe("/beneath"));
    expect(window.location.pathname).toBe("/beneath");
  });
});
