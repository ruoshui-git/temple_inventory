import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src");
function readTree(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    return entry.isDirectory()
      ? readTree(filename)
      : entry.name.endsWith(".vue")
        ? [filename]
        : [];
  });
}

// A template branch that renders the image column must render the shared
// thumbnail; a raw `{{ value }}` fallback would print the image URL instead.
const imageBranch = /column(?:\.id)?\s*===\s*["']image["']/;

describe("item image columns", () => {
  it("renders ItemImage in every page or table component that declares an image column", () => {
    const branchFiles = readTree(root).filter((filename) =>
      imageBranch.test(readFileSync(filename, "utf8")),
    );
    expect(branchFiles.length).toBeGreaterThan(0);
    for (const filename of branchFiles) {
      const source = readFileSync(filename, "utf8");
      expect(
        /\bItemImage\b/.test(source),
        `${filename} renders an image column without ItemImage`,
      ).toBe(true);
    }
  });

  it("keeps the damaged page image branch on ItemImage and out of the raw value fallback", () => {
    const source = readFileSync(
      join(root, "features/pending/PendingView.vue"),
      "utf8",
    );
    const branch = source.match(
      /v-if="column\.id === 'image'"[\s\S]*?<\/div>/,
    )?.[0];
    expect(branch).toContain("<ItemImage");
    expect(branch).not.toContain("{{ value }}");
  });
});
