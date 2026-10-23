import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { registerRouteProgress } from "../src/lib/routeProgress";

afterEach(() => vi.useRealTimers());

describe("route progress", () => {
  it("appears only after 150ms and clears after navigation", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/slow", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    let visible = false;
    const unregister = registerRouteProgress(
      router,
      (value) => (visible = value),
    );
    router.beforeResolve(async (to) => {
      if (to.path === "/slow") await gate;
    });
    const navigation = router.push("/slow");
    await vi.advanceTimersByTimeAsync(149);
    expect(visible).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(visible).toBe(true);
    release();
    await navigation;
    await vi.advanceTimersByTimeAsync(180);
    expect(visible).toBe(false);
    unregister();
  });
});
