import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => router,
}));

import { useBackNavigation } from "../src/composables/useBackNavigation";

describe("useBackNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("goes back when browser history has a previous route", () => {
    vi.stubGlobal("window", {
      history: { state: { back: "/inventory/stock" } },
    });
    const fallback = { name: "stock" };

    useBackNavigation().goBack(fallback);

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("replaces with its fallback when there is no previous route", () => {
    vi.stubGlobal("window", { history: { state: {} } });
    const fallback = { name: "stock" };

    useBackNavigation().goBack(fallback);

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(fallback);
  });

  it("keeps the overlay history skip for routes that request it", () => {
    const go = vi.fn();
    vi.stubGlobal("window", {
      history: { state: { back: "/stock", tiOverlay: "sheet" }, go },
    });

    useBackNavigation().goBack({ name: "stock" }, { preserveOverlay: true });

    expect(go).toHaveBeenCalledWith(-2);
    expect(router.back).not.toHaveBeenCalled();
  });
});
