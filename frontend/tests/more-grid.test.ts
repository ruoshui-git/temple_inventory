import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const utilities = postcss.parse(
  readFileSync(resolve(process.cwd(), "src/styles/utilities.css"), "utf8"),
);

describe("More page card grid", () => {
  it("caps every group at three equal-width cards per row", () => {
    let columns = "";
    utilities.walkRules(".utility-page .more-grid", (rule) => {
      rule.walkDecls("grid-template-columns", (decl) => {
        columns = decl.value.replace(/\s+/g, " ");
      });
    });
    expect(columns).toContain("auto-fill");
    expect(columns).toContain("calc((100% - 2 * var(--p-card-gap)) / 3)");
    expect(columns).toContain("var(--p-card-min-width)");
  });
});
