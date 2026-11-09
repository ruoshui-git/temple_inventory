import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const styles = join(__dirname, "../src/styles");
const cards = readFileSync(join(styles, "cards.css"), "utf8");
const browse = readFileSync(join(styles, "browse.css"), "utf8");

it("sizes every shared phone item-list row from the list-thumbnail density token", () => {
  expect(cards).toMatch(
    /\.stock-list-row\s*\{[^}]*grid-template-columns:\s*var\(--p-list-thumbnail\)/s,
  );
  expect(cards).toMatch(
    /\.stock-list-image,[\s\S]*?width:\s*var\(--p-list-thumbnail\)/,
  );
  expect(cards).toMatch(
    /\.stock-list-skeleton\s+\.skeleton-block__avatar\s*\{[^}]*width:\s*var\(--p-list-thumbnail\)/s,
  );
});

it("keeps phone item names on one ellipsized line at xcompact and compact", () => {
  expect(cards).toMatch(
    /:root\[data-ti-density="xcompact"\] \.stock-list-name,[\s\S]*?:root\[data-ti-density="compact"\] \.stock-list-name\s*\{[^}]*display:\s*block;[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/,
  );
});

it("aligns compact phone row metadata to the item name and leaves room for 更多", () => {
  expect(cards).toMatch(
    /:root\[data-ti-density="xcompact"\] \.stock-list-row > \.card-fields-inline,[\s\S]*?:root\[data-ti-density="compact"\] \.stock-list-row > \.card-fields-inline\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/,
  );
  expect(cards).toMatch(
    /\.browse-card-item--row \.card-fields-inline\s*\{[^}]*gap:\s*6px;/,
  );
  expect(cards).toMatch(
    /\.browse-card-item--row \.card-fields-inline-text\s*\{[^}]*text-overflow:\s*ellipsis;/,
  );
  expect(cards).toMatch(
    /@media \(max-width:\s*1023px\)\s*\{\s*\.operation-record-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  expect(cards).toMatch(
    /:root\[data-ti-density="xcompact"\]\s+\.operation-record-list\s+\.browse-card-item--row:not\(\.stock-list-row\)\s+\.card-fields-inline-text,[\s\S]*?:root\[data-ti-density="compact"\]\s+\.operation-record-list\s+\.browse-card-item--row:not\(\.stock-list-row\)\s+\.card-fields-inline-text\s*\{[^}]*display:\s*flex;[^}]*width:\s*0;[^}]*overflow:\s*hidden;/,
  );
});

it("uses desktop density tokens for filter rows, tree toggles, and browse chrome", () => {
  expect(browse).toMatch(
    /\.browse-filter-rail \.hierarchy-row label\.form-choice-label,[\s\S]*?min-height:\s*max\(24px, var\(--p-cell-control\)\)/,
  );
  expect(browse).toMatch(
    /\.browse-filter-rail \.hierarchy-facet :is\(\.tree-toggle, \.tree-spacer\),[\s\S]*?flex-basis:\s*max\(24px, var\(--p-cell-control\)\)/,
  );
  expect(browse).toMatch(
    /\.browse-filter-rail input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),[\s\S]*?height:\s*var\(--p-control\)/,
  );
  expect(browse).toMatch(
    /\.browse-chrome \.browse-search-container\s*\{[^}]*padding:\s*var\(--p-control-pad-y\)/,
  );
  expect(browse).toMatch(
    /\.browse-chrome \.browse-persistent-chips > \*\s*\{[^}]*min-height:\s*var\(--p-cell-control\)/,
  );
  expect(browse).toMatch(
    /:root\[data-ti-density="compact"\] \.browse-filter-rail \.hierarchy-row,[\s\S]*?min-height:\s*28px/,
  );
});

it("applies per-density image, gutter, gap, and pad tokens to browse cards", () => {
  expect(cards).toMatch(
    /\.browse-card-item--card > \.browse-card-media,[\s\S]*?\.item-card-image\s*\{[^}]*height:\s*var\(--p-card-image-size\)/,
  );
  expect(cards).toMatch(
    /\.browse-card-grid\s*\{[^}]*gap:\s*var\(--p-card-gap\)/,
  );
  expect(cards).toMatch(
    /\.item-card-content\s*\{[^}]*padding:\s*var\(--p-card-pad\)/,
  );
});

it("keeps the phone item and document row heights monotonic and touchable", () => {
  const values = (name: string) =>
    [
      ...cards.matchAll(
        new RegExp(`--browse-${name}-row-height:\\s*(\\d+)px`, "g"),
      ),
    ].map((match) => Number(match[1]));
  expect(values("item")).toEqual([106, 56, 72, 120]);
  expect(values("document")).toEqual([83, 52, 64, 96]);
  expect(
    values("item")
      .slice(1)
      .every((height) => height >= 44),
  ).toBe(true);
  expect(
    values("document")
      .slice(1)
      .every((height) => height >= 44),
  ).toBe(true);
});
