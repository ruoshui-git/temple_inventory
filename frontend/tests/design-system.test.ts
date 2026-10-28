// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";
import { applyDisplayPreferences, themes } from "../src/lib/displayPreferences";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const foundation = postcss.parse(read("src/styles/foundation.css"));
function declarations(selector: string) {
  const values = new Map<string, string>();
  foundation.walkRules((rule) => {
    if (rule.selector === selector && rule.parent?.type === "root")
      rule.walkDecls(/^--p-/, (decl) => {
        values.set(decl.prop, decl.value);
      });
  });
  return values;
}
const tokens = declarations(":root");
function luminance(value: string) {
  const hex = value.slice(1),
    full =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => part + part)
            .join("")
        : hex;
  const channels = [0, 2, 4]
    .map((index) => Number.parseInt(full.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function importGraph(entry: string) {
  const result = new Set<string>(),
    pending = [resolve(process.cwd(), entry)];
  const imports =
    /(?:from\s*|import\s*\(\s*|import\s*|@import\s*)["']([^"']+)["']/g;
  while (pending.length) {
    const path = pending.pop()!;
    if (result.has(path)) continue;
    result.add(path);
    for (const match of readFileSync(path, "utf8").matchAll(imports)) {
      if (!match[1].startsWith(".") && !match[1].startsWith("@/")) continue;
      const target = match[1].startsWith("@/")
        ? resolve("src", match[1].slice(2))
        : resolve(dirname(path), match[1]);
      const found = [
        target,
        target + ".ts",
        target + ".vue",
        target + ".css",
        resolve(target, "index.ts"),
      ].find((path) => existsSync(path));
      if (found) pending.push(found);
    }
  }
  return [...result];
}
afterEach(() => {
  document.documentElement.removeAttribute("style");
  for (const key of ["tiDensity", "tiTheme", "tiTextScale"])
    delete document.documentElement.dataset[key];
});

describe("shared production design system", () => {
  it("keeps the responsive card width tokens and documented phone row geometry", () => {
    expect(tokens.get("--p-card-min-width")).toBe("200px");
    expect(
      declarations(':root[data-ti-density="compact"]').get(
        "--p-card-min-width",
      ),
    ).toBe("160px");
    expect(
      declarations(':root[data-ti-density="spacious"]').get(
        "--p-card-min-width",
      ),
    ).toBe("280px");
    expect(read("src/styles/browse.css")).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
    expect(read("src/components/ui/SkeletonBlock.vue")).toContain(
      "variant === 'stock-row'",
    );
    expect(read("src/features/inventory/StockBrowseView.vue")).toContain(
      'variant="stock-row"',
    );
  });
  it("keeps the documented stylesheet entry and retired preview gallery out of production", () => {
    expect(read("src/main.ts")).toContain('import "./styles/app.css"');
    expect(read("src/main.ts")).not.toContain("frappe-ui/style.css");
    const production = importGraph("src/main.ts");
    expect(production).toContain(resolve("src/styles/app.css"));
    expect(production.some((path) => path.includes("/design-preview/"))).toBe(
      false,
    );
  });
  it("sets explicit initial expansion policies for direct hierarchy filters", () => {
    expect(read("src/components/filters/BrowseFilters.vue")).toContain(
      'title="物品类别"\n\t\t\t\t\tplaceholder="搜索类别"\n\t\t\t\t\tinitial-expansion="first-level"',
    );
    expect(read("src/components/filters/BrowseFilters.vue")).toContain(
      'title="仓库 / 位置"\n\t\t\t\t\tplaceholder="搜索仓库或位置"\n\t\t\t\t\tinitial-expansion="branching-leaves"',
    );
    expect(read("src/features/items/ItemPicker.vue")).toContain(
      '<BrowseFilters\n\t\t\t\t\t\t\t\tv-model="browseScope"',
    );
    const itemPicker = read("src/features/items/ItemPicker.vue");
    expect(itemPicker).toMatch(
      /purpose === 'inbound'\s*\?\s*\['categories'\]\s*:\s*\['categories', 'warehouses'\]/,
    );
    expect(itemPicker).toContain('props.purpose === "inbound"');
  });

  it("keeps fixture code out of the production import graph", () => {
    const production = importGraph("src/main.ts");
    expect(production.some((path) => path.includes("/tests/support/"))).toBe(
      false,
    );
    expect(production.some((path) => path.includes("/design-preview/"))).toBe(
      false,
    );
  });

  it("preserves exact approved theme values and radius differences at the document root", () => {
    const expected = {
      jade: ["#F4F6F3", "#24332D", "#28684E", "12px", "18px"],
      blue: ["#F5F7FA", "#202938", "#245DB5", "6px", "8px"],
      bronze: ["#F7F5F0", "#292622", "#895024", "10px", "14px"],
    };
    for (const theme of themes) {
      expect([
        theme.canvas,
        theme.ink,
        theme.accent,
        theme.radius,
        theme.cardRadius,
      ]).toEqual(expected[theme.id]);
      applyDisplayPreferences({
        theme: theme.id,
        density: "balanced",
        textScale: 175,
      });
      const style = document.documentElement.style;
      const themeTokens = new Map(tokens);
      for (const [key, value] of declarations(
        `:root[data-ti-theme="${theme.id}"]`,
      ))
        themeTokens.set(key, value);
      expect(themeTokens.get("--p-canvas")).toBe(theme.canvas.toLowerCase());
      expect(themeTokens.get("--p-ink")).toBe(theme.ink.toLowerCase());
      expect(themeTokens.get("--p-accent")).toBe(theme.accent.toLowerCase());
      expect(themeTokens.get("--p-radius-card")).toBe(theme.cardRadius);
      expect(style.getPropertyValue("--p-canvas")).toBe("");
      expect(style.getPropertyValue("--p-text-scale")).toBe("1.75");
      expect(document.documentElement.dataset.tiTheme).toBe(theme.id);
      for (const color of [theme.ink, theme.muted, theme.accent]) {
        expect(contrast(color, theme.canvas)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(color, themeTokens.get("--p-soft")!),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast("#FFFFFF", theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.border, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps semantic status text readable independently of the selected theme", () => {
    for (const status of ["success", "warning", "danger", "info"])
      expect(
        contrast(
          tokens.get("--p-" + status)!,
          tokens.get("--p-" + status + "-bg")!,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    expect(tokens.get("--p-focus")).toContain("--p-accent");
  });

  it("keeps theme-sensitive overlay and shadow colors semantic across shared surfaces", () => {
    for (const name of [
      "--p-shadow-color",
      "--p-shadow-subtle",
      "--p-shadow-raised",
      "--p-shadow-menu",
      "--p-scrim",
    ])
      expect(tokens.get(name)).toBeTruthy();
    for (const path of ["src/styles/browse.css", "src/styles/utilities.css"])
      expect(read(path)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(read("src/components/ui/SearchSelect.vue")).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );
  });

  it("changes density rhythm independently from text scaling and preserves the mobile touch floor", () => {
    expect(tokens.get("--p-control")).toBe("36px");
    expect(
      declarations(':root[data-ti-density="compact"]').get("--p-control"),
    ).toBe("32px");
    expect(
      declarations(':root[data-ti-density="spacious"]').get("--p-control"),
    ).toBe("44px");
    const mobileControls: string[] = [],
      mobileInputs: string[] = [];
    foundation.walkAtRules("media", (media) => {
      if (!/max-width:\s*1023px/.test(media.params)) return;
      media.walkDecls("--p-control", (declaration) => {
        mobileControls.push(declaration.value);
      });
      media.walkDecls("font-size", (declaration) => {
        mobileInputs.push(declaration.value);
      });
    });
    expect(mobileControls.length).toBeGreaterThan(0);
    expect(
      mobileControls.every((value) => Number.parseFloat(value) >= 44),
    ).toBe(true);
    expect(mobileInputs).toContain("max(16px, var(--p-body))");
    expect(tokens.get("--p-body")).toContain("--p-text-scale");
    expect(tokens.get("--p-table-thumbnail")).toBe("48px");
    expect(
      declarations(':root[data-ti-density="compact"]').get(
        "--p-table-thumbnail",
      ),
    ).toBe("32px");
    expect(
      declarations(':root[data-ti-density="spacious"]').get(
        "--p-table-thumbnail",
      ),
    ).toBe("64px");
    foundation.walkRules((rule) => {
      if (!rule.selector?.includes("data-ti-density")) return;
      for (const property of [
        "--p-body",
        "--p-small",
        "--p-heading",
        "--p-section",
        "--p-line",
      ])
        expect(
          rule.nodes?.some((node) => "prop" in node && node.prop === property),
        ).toBe(false);
    });
    for (const path of [
      "src/features/counts/CountWorkspace.vue",
      "src/features/counts/CountEditorView.vue",
    ])
      expect(read(path)).toContain("var(--p-table-thumbnail)");
    for (const scale of [100, 125, 150, 175, 200] as const) {
      applyDisplayPreferences({
        theme: "jade",
        density: "compact",
        textScale: scale,
      });
      expect(
        document.documentElement.style.getPropertyValue("--p-text-scale"),
      ).toBe(String(scale / 100));
      expect(document.documentElement.dataset.tiDensity).toBe("compact");
    }
  });

  it("offsets sticky browse chrome and scroll targets by measured desktop and mobile navigation", () => {
    const browse = postcss.parse(read("src/styles/browse.css"));
    const declarationsFor = (stylesheet: postcss.Root, selector: string) => {
      const values = new Map<string, string>();
      stylesheet.walkRules(selector, (rule) =>
        rule.walkDecls((declaration) =>
          values.set(declaration.prop, declaration.value),
        ),
      );
      return values;
    };
    const toolbar = declarationsFor(browse, ".browse-chrome.browse-chrome");
    expect(toolbar.get("top")).toBe("0");
    expect(toolbar.has("max-block-size")).toBe(false);
    expect(browse.toString()).toContain(".browse-chrome.is-stuck");
    expect(
      declarationsFor(browse, ".browse-chrome.is-stuck")
        .get("box-shadow")
        ?.replace(/\s+/g, " "),
    ).toBe("0 1px 0 var(--p-border), var(--p-shadow-subtle)");

    const rail = new Map<string, string>();
    browse.walkRules((rule) => {
      if (
        !rule.selector
          ?.split(",")
          .some((part) => part.trim() === ".browse-filter-rail")
      )
        return;
      rule.walkDecls((declaration) =>
        rail.set(declaration.prop, declaration.value),
      );
    });
    expect(rail.get("width")).toBe("250px");
    expect(rail.get("align-self")).toBe("start");
    expect(rail.get("min-height")).toBe("0");
    expect(rail.get("overflow-x")).toBe("auto");
    expect(rail.get("overflow-y")).toBe("auto");
    expect(rail.get("top")).toContain("var(--");
    expect(rail.get("top")).toContain("browse-toolbar-height");
    expect(rail.get("max-height")).toContain("calc(");
    const inventory = postcss.parse(read("src/styles/foundation.css"));
    const stockGrid = declarationsFor(
      inventory,
      ".inventory-body.with-filters",
    );
    expect(stockGrid.get("grid-template-columns")).toBe("250px minmax(0, 1fr)");
    expect(stockGrid.get("align-items")).toBe("start");
    expect(
      declarationsFor(browse, ".browse-persistent-search input").get(
        "scroll-margin-block-start",
      ),
    ).toContain("calc(");

    const targets = postcss.parse(read("src/styles/foundation.css"));
    const browseRow = new Map<string, string>();
    targets.walkRules(".results-region [data-browse-row]", (rule) =>
      rule.walkDecls((declaration) =>
        browseRow.set(declaration.prop, declaration.value),
      ),
    );
    expect(browseRow.get("scroll-margin-block-start")).toContain("calc(");
    const table = postcss.parse(read("src/styles/data-table.css"));
    const groupTargets = new Map<string, string>();
    table.walkRules((rule) => {
      if (!rule.selector?.includes(".data-table-group-toggle")) return;
      rule.walkDecls((declaration) =>
        groupTargets.set(declaration.prop, declaration.value),
      );
    });
    expect(groupTargets.get("scroll-margin-block-start")).toContain("calc(");
  });

  it("bounds dense toolbar chips independently from the persistent mobile search", () => {
    const browse = postcss.parse(read("src/styles/browse.css"));
    const chipRegion = browse.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".browse-persistent-chips",
    );
    const chipDeclarations = new Map<string, string>();
    chipRegion?.walkDecls((declaration) =>
      chipDeclarations.set(declaration.prop, declaration.value),
    );
    expect(chipDeclarations.get("max-block-size")).toBe("min(30dvh, 14rem)");
    expect(chipDeclarations.get("overflow")).toBe("auto");
    const mobileSearch = new Map<string, string>();
    browse.walkAtRules("media", (media) => {
      if (media.params !== "(max-width: 600px)") return;
      media.walkRules(".browse-persistent-search", (rule) =>
        rule.walkDecls((declaration) =>
          mobileSearch.set(declaration.prop, declaration.value),
        ),
      );
    });
    expect(mobileSearch.get("min-width")).toBe("min(9rem, 100%)");
    expect(mobileSearch.get("flex-basis")).toBe(
      "clamp(min(9rem, 100%), 48vw, 12rem)",
    );
  });
});
