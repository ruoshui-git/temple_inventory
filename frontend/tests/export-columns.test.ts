import { describe, expect, it } from "vitest";
import { exportFields } from "../src/lib/exportColumns";

describe("exportFields", () => {
  it("preserves visible screen order, de-duplicates fields, and ignores unknown ids", () => {
    expect(
      exportFields(
        {
          image: ["image_file"],
          qty: ["stock_qty", "stock_uom"],
          otherQty: ["stock_uom"],
          hidden: ["hidden_field"],
        },
        ["qty", "unknown", "image", "otherQty", "hidden"],
        ["qty", "image", "otherQty"],
      ),
    ).toEqual(["stock_qty", "stock_uom", "image_file"]);
  });
});
