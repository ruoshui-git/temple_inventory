// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { routeRegistry } from "../src/lib/routeRegistry";
import {
  isForbiddenError,
  isUnavailableError,
} from "../src/lib/serviceFailure";
import { can, routeAllowed } from "../src/lib/capabilities";
import { filterNavigation, moreNavigation } from "../src/lib/appNavigation";
import {
  createReferenceData,
  provideReferenceData,
} from "../src/services/contracts";
import { useCapabilities } from "../src/composables/useCapabilities";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

describe("Phase 1 permission contract", () => {
  it("requires the matching capability on write-entry routes", () => {
    const requires = Object.fromEntries(
      routeRegistry.map((route) => [route.name, route.requires]),
    );
    expect(requires["movement-new"]).toBe("stock_entry.create");
    expect(requires["count-new"]).toBe("stock_reconciliation.create");
    expect(requires["item-new"]).toBe("item.create");
    expect(requires["item-edit"]).toBe("item.write");
    expect(requires.setup).toBe("settings.write");
    expect(requires["activities"]).toBeUndefined();
  });

  it("distinguishes permission failures from ordinary unavailable responses", () => {
    expect(isForbiddenError({ kind: "forbidden", status: 403 })).toBe(true);
    expect(isUnavailableError({ kind: "forbidden", status: 403 })).toBe(true);
    expect(isUnavailableError({ kind: "NetworkError", status: 0 })).toBe(false);
    expect(isUnavailableError({ kind: "DoesNotExistError", status: 404 })).toBe(
      true,
    );
  });

  it("uses false for unknown capabilities and a typed capability lookup", () => {
    const reference = createReferenceData();
    expect(can(reference.capabilities, "item.create")).toBe(false);
    reference.capabilities.item.create = true;
    expect(can(reference.capabilities, "item.create")).toBe(true);
    expect(routeAllowed("item.create", reference.capabilities)).toBe(true);
  });

  it("feeds the composable from application reference state", () => {
    const reference = createReferenceData();
    reference.role_label = "录入员";
    reference.capabilities.stock_entry.create = true;
    let result: ReturnType<typeof useCapabilities> | undefined;
    const child = defineComponent({
      setup() {
        result = useCapabilities();
        return () => h("span");
      },
    });
    const host = defineComponent({
      setup() {
        provideReferenceData(reference);
        return () => h(child);
      },
    });
    const mounted = mount(host);
    expect(result?.can("stock_entry.create")).toBe(true);
    expect(result?.roleLabel.value).toBe("录入员");
    mounted.unmount();
  });

  it("filters navigation with the shared route requirement helper", () => {
    const capabilities = createReferenceData().capabilities;
    expect(
      filterNavigation(
        moreNavigation.flatMap((group) => group.items),
        capabilities,
      ).some((item) => item.key === "setup"),
    ).toBe(false);
    capabilities.settings.write = true;
    expect(
      filterNavigation(
        moreNavigation.flatMap((group) => group.items),
        capabilities,
      ).some((item) => item.key === "setup"),
    ).toBe(true);
  });
});
