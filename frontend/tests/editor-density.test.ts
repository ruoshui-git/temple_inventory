import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("editor density token contract", () => {
  it("sizes operation line controls and row rhythm from shared density tokens", () => {
    const forms = source("../src/styles/forms.css");
    const lines = source("../src/features/documents/OperationLines.vue");
    const editor = source("../src/features/documents/OperationEditorView.vue");
    expect(forms).toContain("min-height: var(--p-control)");
    expect(forms).toContain("min-height: var(--p-cell-control)");
    expect(forms).toContain("min-height: 44px");
    expect(forms).toContain("line-height: var(--p-table-line)");
    expect(forms).toContain(
      "padding-inline-start: calc(var(--p-card-inner-pad) + 2 * var(--p-field-gap))",
    );
    expect(forms).toContain("padding-block-end: var(--p-editor-bottom-pad)");
    expect(forms).toContain("min-height: 0");
    expect(forms).toContain("max-height: var(--p-control)");
    expect(forms).toContain("padding-block: var(--p-control-pad-y)");
    expect(forms).toContain("-webkit-line-clamp: 1");
    expect(forms).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(forms).not.toContain("minmax(58px, 0.55fr)");
    expect(lines).toContain("3.5rem + var(--p-control-gap)");
    expect(editor).not.toContain("!isMobile ||");
  });

  it("uses density tokens for count rows, phone item thumbnails and dialogs", () => {
    const counts = source("../src/features/counts/CountEditorView.vue");
    const picker = source("../src/features/items/ItemPicker.vue");
    const utilities = source("../src/styles/utilities.css");
    expect(counts).toContain(
      "padding: var(--p-table-cell-y) var(--p-table-cell-x)",
    );
    expect(counts).toContain("line-height: var(--p-table-line)");
    expect(picker).toContain("var(--p-list-thumbnail)");
    expect(utilities).toContain(".dialog-content");
    expect(utilities).toContain("padding: var(--p-pad)");
  });
});
