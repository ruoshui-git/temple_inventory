import { describe, expect, it } from "vitest";
import { isBrowseStateUpdate } from "../src/features/warehouses/warehouseRoute";

const at = (query: Record<string, string>, path = "/stock/warehouses") => ({
  path,
  query,
});

describe("warehouse route guard", () => {
  it("lets selection and search mirroring through without asking to leave", () => {
    expect(isBrowseStateUpdate(at({ search: "A" }), at({}))).toBe(true);
    expect(
      isBrowseStateUpdate(
        at({ warehouse: "W2", search: "A" }),
        at({ warehouse: "W1" }),
      ),
    ).toBe(true);
  });

  it("still guards editor, recovery and path changes", () => {
    expect(isBrowseStateUpdate(at({ edit: "W1" }), at({}))).toBe(false);
    expect(
      isBrowseStateUpdate(at({ recovery: "r1" }), at({ recovery: "r0" })),
    ).toBe(false);
    expect(isBrowseStateUpdate(at({}, "/stock/warehouses/W1"), at({}))).toBe(
      false,
    );
  });
});
