import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  resolve(process.cwd(), "src/components/ApplicationShell.vue"),
  "utf8",
);
const globalStyles = readFileSync(
  resolve(process.cwd(), "src/style.css"),
  "utf8",
);

describe("desktop shell viewport contract", () => {
  it("keeps primary navigation independently scrollable", () => {
    expect(shellSource).toMatch(
      /\.desktop-module-navigation\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(shellSource).toMatch(
      /\.desktop-module-navigation\s*>\s*a,\s*\.desktop-module-navigation\s*>\s*button\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/,
    );
  });

  it("keeps desktop filters inside the constrained page viewport", () => {
    expect(globalStyles).toContain(
      ".desktop-list-layout{min-height:0;overflow:hidden}",
    );
    expect(globalStyles).toContain(
      ".desktop-list-layout>.filter-sidebar{position:static;box-sizing:border-box;height:100%;max-height:100%;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}",
    );
    expect(globalStyles).toContain(
      ".desktop-list-layout>.results-column{display:grid",
    );
  });
});
