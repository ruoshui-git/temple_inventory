import { describe, expect, it } from "vitest";
import { placeInVisualViewport } from "../src/composables/useAnchoredPopup";
import { duplicateOperationTarget } from "../src/features/documents/operationRoutes";

describe("operation form popup placement", () => {
  it("fits the popup inside the visual viewport after the keyboard opens", () => {
    const visualViewport = {
      width: 390,
      height: 360,
      offsetLeft: 0,
      offsetTop: 420,
    } as VisualViewport;
    const placement = placeInVisualViewport({
      anchor: {
        top: 680,
        bottom: 724,
        left: 24,
        right: 366,
        width: 342,
        height: 44,
      } as DOMRect,
      viewport: visualViewport,
      popupWidth: 342,
      naturalHeight: 280,
      margin: 8,
      gap: 4,
      minimumHeight: 240,
      align: "start",
    });
    expect(placement.side).toBe("above");
    expect(placement.top).toBeGreaterThanOrEqual(visualViewport.offsetTop + 8);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(
      visualViewport.offsetTop + visualViewport.height - 8,
    );
    expect(placement.left).toBe(24);
  });
});

describe("duplicate operation routing", () => {
  it("points the editor URL at the new draft and preserves browse context", () => {
    expect(
      duplicateOperationTarget("STE-OLD", "STE-NEW", {
        view: "records",
        sort: "date",
      }),
    ).toEqual({
      name: "movement-detail",
      params: { name: "STE-NEW" },
      query: { view: "records", sort: "date" },
    });
  });

  it("does not change routing when duplication did not replace identity", () => {
    expect(duplicateOperationTarget("STE-OLD", "STE-OLD", {})).toBeUndefined();
  });
});
