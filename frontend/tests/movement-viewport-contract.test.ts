import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(resolve(process.cwd(), file), "utf8").replace(/\s+/g, " ");

describe("mobile Movement viewport contract", () => {
  it("keeps the page viewport-safe and gives results the only internal scroll surface", () => {
    const view = source("src/features/movements/MovementsView.vue");
    const globalStyle = source("src/style.css");

    expect(view).toContain(
      "height: calc( 100dvh - var(--mobile-nav-height, 0px) - var(--mobile-context-nav-height, 0px) );",
    );
    expect(view).toContain("max-width: 100vw;");
    expect(view).toContain(
      ".movement-ledger > .desktop-list-layout > .results-column",
    );
    expect(view).toContain("min-width: 0;");
    expect(view).toContain("overflow-x: hidden;");
    expect(view).toContain("overflow-y: auto;");
    expect(view).toContain(
      ".movement-ledger .results-column.compact .movement-ledger-header { display: flex; flex-direction: column;",
    );
    expect(globalStyle).toContain(
      ".shell-content:has(> .movement-ledger){padding-bottom:0;overflow:hidden}",
    );
    expect(globalStyle).toContain(
      ".mobile-context-nav{position:fixed;z-index:44;top:0;right:0;bottom:auto;left:0;display:grid;box-sizing:border-box;min-height:40px;height:40px;",
    );
    expect(globalStyle).toContain(
      ".floating-action-menu{bottom:calc(var(--mobile-nav-height) + 16px)}",
    );
    expect(globalStyle).toContain(
      ".action-fab{right:18px;bottom:calc(var(--mobile-nav-height) + 16px)}",
    );
    expect(globalStyle).not.toContain(
      ".action-fab{right:18px;bottom:calc(var(--mobile-nav-height) + var(--mobile-context-nav-height)",
    );
  });
});
