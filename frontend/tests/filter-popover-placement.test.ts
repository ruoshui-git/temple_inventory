import { describe, expect, it } from "vitest";
import { chooseFilterPopoverPlacement } from "../src/lib/filterPopoverPlacement";

describe("filter popover placement", () => {
  it("flips above when the panel cannot fit below and the upper space is larger", () => {
    expect(
      chooseFilterPopoverPlacement({
        triggerTop: 520,
        triggerBottom: 560,
        viewportHeight: 900,
        naturalHeight: 480,
      }),
    ).toEqual({ side: "above", top: 32, maxHeight: 500, minHeight: 360 });
  });

  it("uses natural height as the minimum when the panel is shorter than the target", () => {
    const placement = chooseFilterPopoverPlacement({
      triggerTop: 100,
      triggerBottom: 140,
      viewportHeight: 900,
      naturalHeight: 240,
    });
    expect(placement).toMatchObject({
      side: "below",
      maxHeight: 740,
      minHeight: 240,
    });
  });
});
