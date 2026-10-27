import { describe, expect, it } from "vitest";
import { createReferenceData } from "../src/services/contracts";
import {
  decodeOperation,
  encodeOperation,
  newOperation,
} from "../src/features/documents/operationCodec";
import {
  copyOperationLine,
  mergeCompatibleOperationLines,
  moveOperationLine,
  moveOperationSection,
  operationSectionLocation,
  operationSections,
  type AllocationLine,
} from "../src/features/documents/operationModel";

function line(
  id: string,
  overrides: Partial<AllocationLine> = {},
): AllocationLine {
  return {
    id,
    localId: id,
    code: "ITEM-A",
    qty: 2,
    uom: "Nos",
    entryQty: 2,
    entryUom: "Nos",
    conversionFactor: 1,
    location: "ROOM-A",
    sourceLocation: "ROOM-A",
    ...overrides,
  };
}

describe("operation location sections", () => {
  it("groups by the primary location for each operation kind", () => {
    const receive = newOperation("Receive", createReferenceData());
    receive.items = [
      line("a", { location: "ROOM-A" }),
      line("b", { location: "ROOM-B" }),
    ];
    expect(
      operationSections(receive).map((section) => [
        section.location,
        section.lines.length,
      ]),
    ).toEqual([
      ["ROOM-A", 1],
      ["ROOM-B", 1],
    ]);
    const transfer = newOperation("Transfer", createReferenceData());
    transfer.items = [
      line("c", { sourceLocation: "ROOM-A", location: "ROOM-B" }),
      line("d", { sourceLocation: "ROOM-A", location: "ROOM-C" }),
    ];
    expect(
      operationSections(transfer).map((section) => section.location),
    ).toEqual(["ROOM-A"]);
    for (const kind of [
      "Issue",
      "Loss",
      "Loan",
      "Damage",
      "Disposal",
      "Transfer",
    ] as const)
      expect(
        operationSectionLocation(
          kind,
          line("source", { sourceLocation: "SOURCE", location: "TARGET" }),
        ),
      ).toBe("SOURCE");
    for (const kind of ["Receive", "Return", "Repair"] as const)
      expect(
        operationSectionLocation(
          kind,
          line("target", { sourceLocation: "SOURCE", location: "TARGET" }),
        ),
      ).toBe("TARGET");
  });

  it("moves a section and merges only compatible basic rows", () => {
    const draft = newOperation("Issue", createReferenceData());
    const first = line("a", {
      sourceLocation: "ROOM-A",
      location: "ROOM-A",
      qty: 2,
      entryQty: 2,
    });
    const second = line("b", {
      sourceLocation: "ROOM-B",
      location: "ROOM-B",
      qty: 3,
      entryQty: 3,
    });
    const bundled = line("bundle", {
      sourceLocation: "ROOM-B",
      location: "ROOM-B",
      nativeBundle: "BUNDLE",
    });
    draft.items = [first, second, bundled];
    moveOperationSection(draft, operationSections(draft)[1]!, "ROOM-A");
    mergeCompatibleOperationLines(draft);
    expect(draft.items).toHaveLength(2);
    expect(draft.items[0]).toMatchObject({
      id: "a",
      qty: 5,
      entryQty: 5,
      sourceLocation: "ROOM-A",
    });
    expect(draft.items[1]).toMatchObject({
      id: "bundle",
      nativeBundle: "BUNDLE",
    });
  });

  it("moves a single row to another primary location", () => {
    const draft = newOperation("Transfer", createReferenceData());
    const row = line("a", { sourceLocation: "ROOM-A", location: "ROOM-B" });
    draft.items = [row];
    moveOperationLine(draft, row, "ROOM-C");
    expect(row).toMatchObject({ sourceLocation: "ROOM-C", location: "ROOM-B" });
    expect(operationSections(draft).map((section) => section.location)).toEqual(
      ["ROOM-C"],
    );
  });

  it("does not merge allocations with different unknown native values or outcomes", () => {
    const draft = newOperation("Issue", createReferenceData());
    draft.items = [
      line("custom-a", { nativeFields: { ti_custom_value: "a" } }),
      line("custom-b", { nativeFields: { ti_custom_value: "b" } }),
      line("outcome-a", { returnOutcome: "returned" }),
      line("outcome-b", { returnOutcome: "returned" }),
    ];
    mergeCompatibleOperationLines(draft);
    expect(draft.items.map((row) => row.id)).toEqual([
      "custom-a",
      "custom-b",
      "outcome-a",
      "outcome-b",
    ]);
  });

  it("keeps mixed-unit batches as separate rows and duplicates with blank quantity and batch", () => {
    const box = line("box", {
      batch: "B-1",
      qty: 12,
      uom: "Nos",
      entryUom: "Box",
      entryQty: 1,
      conversionFactor: 12,
    });
    const each = line("each", {
      batch: "B-2",
      qty: 5,
      uom: "Nos",
      entryUom: "Nos",
      entryQty: 5,
    });
    const draft = newOperation("Receive", createReferenceData());
    draft.items = [box, each];
    mergeCompatibleOperationLines(draft);
    expect(
      operationSections(draft)[0]?.lines.map((row) => row.entryUom),
    ).toEqual(["Box", "Nos"]);
    const copy = copyOperationLine(box);
    expect(copy).toMatchObject({
      qty: 0,
      entryQty: 0,
      batch: "",
      entryUom: "Box",
    });
    expect(copy.id).not.toBe(box.id);
  });

  it("round-trips child identities, order, unknown native fields and changed warehouses", () => {
    const reference = createReferenceData();
    reference.company = "TEMPLE";
    const draft = newOperation("Issue", reference);
    const decoded = decodeOperation({
      doctype: "Stock Entry",
      name: "STE-1",
      version: "v1",
      docstatus: 0,
      items: [
        {
          name: "ROW-A",
          item_code: "ITEM-A",
          qty: 1,
          uom: "Nos",
          stock_uom: "Nos",
          conversion_factor: 1,
          s_warehouse: "ROOM-A",
          t_warehouse: null,
          custom_native_field: { keep: true },
        },
        {
          name: "ROW-B",
          item_code: "ITEM-B",
          qty: 2,
          uom: "Nos",
          stock_uom: "Nos",
          conversion_factor: 1,
          s_warehouse: "ROOM-A",
          t_warehouse: null,
          another_native_field: "untouched",
        },
      ],
    } as never);
    draft.items = decoded.items;
    draft.items[0]!.sourceLocation = "ROOM-B";
    const encoded = encodeOperation(draft, reference);
    const rows = encoded.items as Record<string, unknown>[];
    expect(rows.map((row) => row.name)).toEqual(["ROW-A", "ROW-B"]);
    expect(rows[0]).toMatchObject({
      s_warehouse: "ROOM-B",
      custom_native_field: { keep: true },
    });
    expect(rows[1]).toMatchObject({
      s_warehouse: "ROOM-A",
      another_native_field: "untouched",
    });
  });
});
