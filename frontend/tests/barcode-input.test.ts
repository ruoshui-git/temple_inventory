import { describe, expect, it } from "vitest";
import { appendBarcode } from "../src/features/items/barcodeInput";

describe("item barcode capture", () => {
  it("trims the scanned value while preserving leading zeros, case, and existing text", () => {
    expect(appendBarcode("OLD\n", "  00AbC  ")).toBe("OLD\n00AbC");
  });

  it("does not duplicate an existing code or mutate the form for an empty scan", () => {
    expect(appendBarcode("00123\nABC", " 00123 ")).toBe("00123\nABC");
    expect(appendBarcode("00123\nABC", "  ")).toBe("00123\nABC");
  });
});
