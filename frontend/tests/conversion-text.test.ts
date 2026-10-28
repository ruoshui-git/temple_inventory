import { afterEach, describe, expect, it } from "vitest";
import { formatConversion } from "../src/lib/conversionText";
import { setUnitSource } from "../src/lib/units";

afterEach(() => setUnitSource(undefined));

describe("formatConversion", () => {
  it("shows a converted amount and its unit rate with display labels", () => {
    setUnitSource({
      units: [
        { name: "Box", label: "箱" },
        { name: "Nos", label: "个" },
      ],
    });

    expect(
      formatConversion({ qty: 2, uom: "Box", factor: 12, stockUom: "Nos" }),
    ).toBe("2 箱 = 24 个（1 箱 = 12 个）");
  });

  it("omits the redundant rate when the entered quantity is one", () => {
    setUnitSource({
      units: [
        { name: "Box", label: "箱" },
        { name: "Nos", label: "个" },
      ],
    });

    expect(
      formatConversion({ qty: 1, uom: "Box", factor: 5, stockUom: "Nos" }),
    ).toBe("1 箱 = 5 个");
  });

  it("omits redundant conversions and rejects invalid rates", () => {
    expect(
      formatConversion({ qty: 4, uom: "Nos", factor: 1, stockUom: "Nos" }),
    ).toBeNull();
    expect(
      formatConversion({ qty: 4, uom: "Box", factor: 0, stockUom: "Nos" }),
    ).toBeNull();
  });
});
