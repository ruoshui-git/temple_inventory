import { describe, expect, it, vi } from "vitest";
import type { InventoryServices } from "../src/services/contracts";
import { createReferenceData } from "../src/services/contracts";
import { refreshUnitReference } from "../src/services/units";

describe("unit service refresh", () => {
  it("reloads only units and preserves labels, categories and disabled rows", async () => {
    const reference = createReferenceData();
    const call = vi.fn().mockResolvedValue([
      {
        name: "Nos",
        label: "个",
        category: "Count",
        must_be_whole_number: true,
        enabled: false,
      },
    ]);
    const services = { call } as unknown as InventoryServices;

    await refreshUnitReference(services, reference);

    expect(call).toHaveBeenCalledExactlyOnceWith("units.list_units");
    expect(reference.units).toEqual([
      {
        name: "Nos",
        label: "个",
        whole: true,
        category: "Count",
        enabled: false,
      },
    ]);
  });
});
