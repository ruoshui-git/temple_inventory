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

  it("aligns to the end and clamps at the viewport's right margin", () => {
    const placement = chooseFilterPopoverPlacement({
      triggerTop: 100,
      triggerBottom: 140,
      viewportHeight: 900,
      naturalHeight: 240,
      triggerLeft: 940,
      triggerRight: 1014,
      viewportWidth: 1024,
      popupWidth: 240,
      align: "end",
      horizontalMargin: 8,
    });
    expect(placement.left).toBe(774);
  });

  it("aligns to the start and clamps a trigger at the right edge", () => {
    const placement = chooseFilterPopoverPlacement({
      triggerTop: 100,
      triggerBottom: 140,
      viewportHeight: 900,
      naturalHeight: 240,
      triggerLeft: 1014,
      triggerRight: 1024,
      viewportWidth: 1024,
      popupWidth: 240,
      align: "start",
      horizontalMargin: 8,
    });
    expect(placement.left).toBe(776);
  });
});
