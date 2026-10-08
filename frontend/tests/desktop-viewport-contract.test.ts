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
    expect(globalStyles).toMatch(
      /\.desktop-list-layout\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(globalStyles).toMatch(
      /\.desktop-list-layout\s*>\s*\.filter-sidebar\s*\{[\s\S]*?position:\s*static;[\s\S]*?box-sizing:\s*border-box;[\s\S]*?height:\s*100%;[\s\S]*?max-height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;?/,
    );
    expect(globalStyles).toMatch(
      /\.desktop-list-layout\s*>\s*\.results-column\s*\{[\s\S]*?display:\s*grid;/,
    );
    expect(globalStyles).toMatch(
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.filter-drawer-done\s*\{[\s\S]*?display:\s*block;/,
    );
  });
});
