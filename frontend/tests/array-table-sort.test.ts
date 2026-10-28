import { describe, expect, it } from "vitest";
import {
  compareTableValues,
  nextTableSort,
} from "../src/composables/useArrayTableSort";

describe("shared array table sorting", () => {
  it("uses the same Chinese numeric collator for values", () => {
    expect(compareTableValues("item 10", "item 2")).toBeGreaterThan(0);
  });

  it("toggles the active field and starts a new field in the requested direction", () => {
    expect(nextTableSort("name", "name", "asc")).toEqual({
      field: "name",
      direction: "desc",
    });
    expect(nextTableSort("date", "name", "asc", "desc")).toEqual({
      field: "date",
      direction: "desc",
    });
  });
});
