// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Overlay from "../src/components/ui/Overlay.vue";
import DataTable from "../src/components/ui/DataTable.vue";
import { filterUnitRows, unitGroupExpanded } from "../src/lib/unitBrowse";
import { presentationText } from "../src/lib/presentationLabels";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

describe("shared UX conventions", () => {
  it("uses the shared loading and empty labels in DataTable", async () => {
    const loading = mount(DataTable, {
      props: {
        ariaLabel: "单位",
        columns: [],
        rows: [],
        loading: true,
        initialized: false,
      },
    });
    wrappers.push(loading);
    expect(loading.text()).toContain(presentationText.loading);
    loading.unmount();

    const empty = mount(DataTable, {
      props: { ariaLabel: "单位", columns: [], rows: [] },
    });
    wrappers.push(empty);
    await flushPromises();
    expect(empty.text()).toContain(presentationText.noMatches);
    expect(presentationText.location).toBe("位置");
    expect(presentationText.saveFailed("请重试")).toBe("保存失败：请重试");
  });

  it("keeps every numeric quantity input on the decimal keypad", async () => {
    const files = [
      "src/features/counts/CountWorkspace.vue",
      "src/features/counts/CountEditorView.vue",
      "src/features/conversions/ConversionEditor.vue",
      "src/features/opening/OpeningEditorView.vue",
      "src/features/documents/InboundSerialField.vue",
      "src/features/documents/OperationLines.vue",
    ];
    for (const file of files) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      const controls =
        source.match(/<input\b[^>]*\btype="number"[^>]*>/gs) || [];
      expect(controls, file).not.toHaveLength(0);
      for (const control of controls)
        expect(control, file).toContain('inputmode="decimal"');
    }
  });

  it("filters unit rows and keeps groups collapsed until search expands matches", () => {
    const rows = [
      {
        name: "Piece",
        label: "件",
        category: "数量",
        must_be_whole_number: true,
        enabled: true,
      },
      {
        name: "Kilogram",
        label: "千克",
        category: "重量",
        must_be_whole_number: false,
        enabled: true,
      },
    ] as never[];
    const filtered = filterUnitRows(rows as never, "千克", "", "all", "all");
    expect(filtered.map((row) => row.name)).toEqual(["Kilogram"]);
    expect(
      unitGroupExpanded(
        "category:数量",
        new Set(["category:数量"]),
        false,
        new Set(),
        new Set(),
      ),
    ).toBe(true);
    expect(
      unitGroupExpanded(
        "category:重量",
        new Set(["category:数量"]),
        false,
        new Set(),
        new Set(),
      ),
    ).toBe(false);
    expect(
      unitGroupExpanded(
        "category:重量",
        new Set(["category:数量"]),
        true,
        new Set(),
        new Set(),
      ),
    ).toBe(true);
  });

  it("disables the new transitions under reduced motion", async () => {
    const foundation = await readFile(
      resolve(process.cwd(), "src/styles/foundation.css"),
      "utf8",
    );
    const browse = await readFile(
      resolve(process.cwd(), "src/styles/browse.css"),
      "utf8",
    );
    expect(foundation).toContain("--p-motion: 140ms");
    expect(foundation).toContain("--p-motion-fast: 90ms");
    expect(foundation).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important/,
    );
    expect(browse).toContain(".selection-bar-enter-active");
    expect(browse).toContain("transform: translateY(6px)");
    const operationLines = await readFile(
      resolve(process.cwd(), "src/features/documents/OperationLines.vue"),
      "utf8",
    );
    expect(operationLines).toContain('@enter="enterLine"');
    expect(operationLines).toContain('@leave="leaveLine"');
    expect(operationLines).toContain("prefers-reduced-motion: reduce");
  });

  it("closes an overlay with Escape while its enter animation is active", async () => {
    const wrapper = mount(Overlay, {
      attachTo: document.body,
      props: { title: "编辑单位" },
      slots: { default: "内容" },
    });
    wrappers.push(wrapper);
    document
      .querySelector<HTMLElement>(".ui-overlay")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
