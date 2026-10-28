import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import {
  createReferenceData,
  provideReferenceData,
} from "../src/services/contracts";
import {
  compareUnits,
  setUnitSource,
  sortByUnit,
  unitLabel,
  unitRank,
  unitOption,
} from "../src/lib/units";

describe("shared unit labels and ordering", () => {
  it("falls back to names and alphabetical ordering without reference data", () => {
    expect(unitLabel("Nos")).toBe("Nos");
    expect(unitRank("unknown")).toBe(Number.MAX_SAFE_INTEGER);
    expect(compareUnits("z-unit", "a-unit")).toBeGreaterThan(0);
    expect(sortByUnit([{ uom: "z" }, { uom: "a" }], (row) => row.uom)).toEqual([
      { uom: "a" },
      { uom: "z" },
    ]);
  });

  it("reads labels and rank from the provided reactive reference store", async () => {
    const reference = createReferenceData();
    reference.units = [
      { name: "Nos", label: "个", whole: true },
      { name: "Set", label: "套", whole: true },
    ];
    let values: unknown;
    const Consumer = defineComponent({
      setup() {
        values = {
          label: unitLabel("Nos"),
          objectLabel: unitLabel({ name: "Set" }),
          rank: unitRank("Set"),
          sorted: sortByUnit(
            [{ uom: "Set" }, { uom: "Nos" }],
            (row) => row.uom,
          ),
        };
        return () => h("div");
      },
    });
    const Host = defineComponent({
      setup() {
        provideReferenceData(reference);
        return () => h(Consumer);
      },
    });
    await renderToString(createSSRApp(Host));
    expect(values).toEqual({
      label: "个",
      objectLabel: "套",
      rank: 1,
      sorted: [{ uom: "Nos" }, { uom: "Set" }],
    });
  });

  it("resolves labels outside component setup once reference data is registered", () => {
    const reference = createReferenceData();
    reference.units = [{ name: "Box", label: "箱", whole: true }];
    setUnitSource(reference);
    expect(unitLabel("Box")).toBe("箱");
    reference.units = [];
    expect(unitLabel("Box")).toBe("Box");
    setUnitSource(undefined);
  });

  it("builds translated unit options with native names and conversion factors", () => {
    const reference = createReferenceData();
    reference.units = [
      { name: "Nos", label: "个", whole: true },
      { name: "Box", label: "箱", whole: true },
    ];
    setUnitSource(reference);
    expect(unitOption("Nos")).toEqual({
      value: "Nos",
      label: "个",
      detail: "Nos",
    });
    expect(unitOption("Box", { factor: 12, stockUom: "Nos" })).toEqual({
      value: "Box",
      label: "箱",
      detail: "Box · 1 箱 = 12 个",
    });
    setUnitSource(undefined);
  });
});
