import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(resolve(process.cwd(), file), "utf8").replace(/\s+/g, " ");

describe("mobile Movement viewport contract", () => {
  it("keeps the page viewport-safe and gives results the only internal scroll surface", () => {
    const view = source("src/features/movements/MovementsView.vue");
    const parsedGlobalStyle = postcss.parse(
      readFileSync(resolve(process.cwd(), "src/style.css"), "utf8"),
    );

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
    const movementShellRule = parsedGlobalStyle.nodes?.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".shell-content:has(> .movement-ledger)",
    );
    expect(movementShellRule?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prop: "padding-bottom", value: "0" }),
        expect.objectContaining({ prop: "overflow", value: "hidden" }),
      ]),
    );
    const rules = new Map<string, Map<string, string[]>>();
    parsedGlobalStyle.walkRules((rule) => {
      let declarations = rules.get(rule.selector);
      if (!declarations) {
        declarations = new Map();
        rules.set(rule.selector, declarations);
      }
      rule.walkDecls((decl) => {
        const values = declarations!.get(decl.prop) ?? [];
        values.push(decl.value);
        declarations!.set(decl.prop, values);
      });
    });
    expect(rules.get(".mobile-context-nav")?.get("z-index")).toContain(
      "var(--ti-layer-context)",
    );
    expect(rules.get(".mobile-context-nav")?.get("position")).toContain(
      "fixed",
    );
    expect(rules.get(".mobile-context-nav")?.get("top")).toContain("0");
    expect(rules.get(".mobile-context-nav")?.get("right")).toContain("0");
    expect(rules.get(".mobile-context-nav")?.get("bottom")).toContain("auto");
    expect(rules.get(".mobile-context-nav")?.get("left")).toContain("0");
    expect(rules.get(".mobile-context-nav")?.get("display")).toContain("grid");
    expect(rules.get(".mobile-context-nav")?.get("box-sizing")).toContain(
      "border-box",
    );
    expect(rules.get(".mobile-context-nav")?.get("min-height")).toContain(
      "44px",
    );
    expect(rules.get(".mobile-context-nav")?.get("height")).toContain("44px");
    expect(rules.get(".floating-action-menu")?.get("bottom")).toContain(
      "calc(var(--mobile-nav-height) + 16px)",
    );
    expect(rules.get(".action-fab")?.get("right")).toContain("18px");
    expect(rules.get(".action-fab")?.get("bottom")).toContain(
      "calc(var(--mobile-nav-height) + 16px)",
    );
    expect(
      rules
        .get(".action-fab")
        ?.get("bottom")
        ?.some((value) => value.includes("var(--mobile-context-nav-height)")),
    ).toBe(false);
  });
});
