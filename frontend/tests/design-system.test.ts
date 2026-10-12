import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Container, type Declaration, type Root } from "postcss";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const tokenCss = postcss.parse(read("src/styles/tokens.css"));
const primitiveCss = postcss.parse(read("src/styles/primitives.css"));
const globalCss = postcss.parse(read("src/style.css"));
const rootTokens = declarationsFor(tokenCss, ":root");

function declarationsFor(root: Container, selector: string) {
  const values = new Map<string, string>();
  root.nodes?.forEach((node) => {
    if (node.type === "rule" && node.selector === selector) {
      node.walkDecls(/^--ti-/, (declaration) => {
        values.set(declaration.prop, declaration.value);
      });
    }
  });
  return values;
}

function resolveToken(name: string, stack: string[] = []): string {
  if (stack.includes(name)) {
    throw new Error(`Token cycle: ${[...stack, name].join(" -> ")}`);
  }
  const value = rootTokens.get(name);
  if (!value) throw new Error(`Unresolved token ${name}`);
  return value.replace(
    /var\((--ti-[\w-]+)(?:\s*,\s*([^()]+))?\)/g,
    (_match, ref, fallback) => {
      if (!rootTokens.has(ref) && fallback) return fallback.trim();
      return resolveToken(ref, [...stack, name]);
    },
  );
}

function color(value: string): [number, number, number] {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full =
      hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
    return [0, 2, 4].map((index) =>
      Number.parseInt(full.slice(index, index + 2), 16),
    ) as [number, number, number];
  }
  const rgb = value.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`Unsupported color value: ${value}`);
}

function luminance(rgb: [number, number, number]) {
  const linear = rgb.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string) {
  const values = [
    luminance(color(foreground)),
    luminance(color(background)),
  ].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function pixels(value: string | undefined) {
  return Number.parseFloat(value ?? "");
}

function declaration(root: Root, property: string, selectorPattern: RegExp) {
  let found: Declaration | undefined;
  root.walkRules((rule) => {
    if (selectorPattern.test(rule.selector)) {
      rule.walkDecls(property, (decl) => {
        found ??= decl;
      });
    }
  });
  return found;
}

describe("production design system contract", () => {
  it("resolves every root token without cycles or missing references", () => {
    for (const name of rootTokens.keys()) {
      expect(resolveToken(name), name).not.toMatch(/var\(--ti-/);
    }
  });

  it("keeps status and movement labels readable against their semantic fills", () => {
    const pairs = [
      ["success", "success-bg"],
      ["warning", "warning-bg"],
      ["danger", "danger-bg"],
      ["info", "info-bg"],
      ...[
        "receive",
        "issue",
        "transfer",
        "loan",
        "return",
        "opening",
        "damage",
        "reconcile",
      ].map((name) => [`movement-${name}`, `movement-${name}-bg`]),
    ];

    for (const [foreground, background] of pairs) {
      const ratio = contrast(
        resolveToken(`--ti-${foreground}`),
        resolveToken(`--ti-${background}`),
      );
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    for (const foreground of ["--ti-ink", "--ti-muted", "--ti-accent"]) {
      for (const background of [
        "--ti-canvas",
        "--ti-surface",
        "--ti-accent-soft",
      ]) {
        expect(
          contrast(resolveToken(foreground), resolveToken(background)),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(
      contrast(
        resolveToken("--ti-border-strong"),
        resolveToken("--ti-surface"),
      ),
      "strong border on surface",
    ).toBeGreaterThanOrEqual(3);

    const focusColor = resolveToken("--ti-accent");
    for (const surface of ["--ti-surface", "--ti-surface-raised"]) {
      expect(
        contrast(focusColor, resolveToken(surface)),
        `focus ring against ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("makes density change control and content rhythm, with a mobile touch floor", () => {
    const compact = declarationsFor(
      tokenCss,
      ':root[data-ti-density="compact"]',
    );
    const spacious = declarationsFor(
      tokenCss,
      ':root[data-ti-density="spacious"]',
    );
    expect(pixels(rootTokens.get("--ti-density-control"))).toBe(36);
    expect(pixels(compact.get("--ti-density-control"))).toBe(32);
    expect(pixels(spacious.get("--ti-density-control"))).toBe(44);
    for (const token of [
      "--ti-density-control",
      "--ti-density-page",
      "--ti-density-gap",
      "--ti-density-row-gap",
    ]) {
      expect(compact.get(token), token).toBeDefined();
      expect(spacious.get(token), token).toBeDefined();
      expect(compact.get(token), token).not.toBe(spacious.get(token));
    }

    expect(
      declaration(
        primitiveCss,
        "min-height",
        /^(?:button|input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)|select|textarea)$/,
      )?.value,
    ).toContain("--ti-density-control");
    const cardGrid = postcss.parse(
      read("src/components/InventoryCardGrid.vue").match(
        /<style[^>]*>([\s\S]*?)<\/style>/,
      )?.[1] ?? "",
    );
    const expiryGrid = postcss.parse(
      read("src/components/ExpiryCardGrid.vue").match(
        /<style[^>]*>([\s\S]*?)<\/style>/,
      )?.[1] ?? "",
    );
    const table = postcss.parse(
      read("src/components/SortableDataTableDesktopRenderer.vue").match(
        /<style[^>]*>([\s\S]*?)<\/style>/,
      )?.[1] ?? "",
    );
    expect(
      declaration(cardGrid, "gap", /^\.inventory-card-grid$/)?.value,
    ).toContain("--ti-density-gap");
    expect(
      declaration(expiryGrid, "gap", /^\.expiry-card-grid$/)?.value,
    ).toContain("--ti-density-gap");
    expect(
      declaration(table, "padding", /sortable-data-table-desktop th/)?.value,
    ).toContain("--ti-density-row-gap");

    let mobileMedia: Container | undefined;
    tokenCss.walkAtRules("media", (media) => {
      if (/max-width:\s*1023px/.test(media.params)) {
        mobileMedia = media;
      }
    });
    expect(mobileMedia).toBeDefined();
    const mobileBase = declarationsFor(mobileMedia!, ":root");
    const mobileCompact = declarationsFor(
      mobileMedia!,
      ':root[data-ti-density="compact"]',
    );
    const mobileBalanced = declarationsFor(
      mobileMedia!,
      ':root[data-ti-density="balanced"]',
    );
    const mobileSpacious = declarationsFor(
      mobileMedia!,
      ':root[data-ti-density="spacious"]',
    );
    expect(
      pixels(mobileBase.get("--ti-density-control")),
    ).toBeGreaterThanOrEqual(44);
    for (const density of [mobileCompact, mobileBalanced, mobileSpacious]) {
      expect(
        pixels(density.get("--ti-density-control")),
      ).toBeGreaterThanOrEqual(44);
      expect(pixels(density.get("--ti-font-body"))).toBeGreaterThanOrEqual(16);
    }
    const mobileInputText: string[] = [];
    tokenCss.walkAtRules("media", (media) => {
      if (/max-width:\s*1023px/.test(media.params)) {
        media.walkRules(/^(?:input|select|textarea)/, (rule) => {
          rule.walkDecls("font-size", (decl) =>
            mobileInputText.push(decl.value),
          );
        });
      }
    });
    expect(mobileInputText).toContain("16px");

    let narrowPhone: Container | undefined;
    globalCss.walkAtRules("media", (media) => {
      if (
        /max-width:\s*480px/.test(media.params) &&
        media.nodes?.some(
          (node) => node.type === "rule" && node.selector === ".app-shell",
        )
      ) {
        narrowPhone = media;
      }
    });
    expect(declaration(narrowPhone!, "padding", /^\.app-shell$/)?.value).toBe(
      "var(--ti-density-page)",
    );
  });

  it("loads app controls after frappe-ui and integrates its autocomplete with density and portal layers", () => {
    const main = read("src/main.ts");
    expect(main.indexOf('"frappe-ui/style.css"')).toBeGreaterThanOrEqual(0);
    expect(main.indexOf('"frappe-ui/style.css"')).toBeLessThan(
      main.indexOf('"./styles/tokens.css"'),
    );
    expect(main.indexOf('"./styles/tokens.css"')).toBeLessThan(
      main.indexOf('"./styles/primitives.css"'),
    );

    const form = read("src/components/ItemCreateForm.vue");
    expect(form).toMatch(/import\s*\{\s*Combobox\s*\}\s*from\s*["']frappe-ui/);
    expect(form).toMatch(/<Combobox\b[\s\S]*?aria-label=/);
    const triggerSizing = declaration(
      globalCss,
      "min-height",
      /\[data-slot="trigger"\]\[data-variant\]\[data-size\]/,
    )?.value;
    const portalLayer = declaration(
      globalCss,
      "z-index",
      /\[data-selection\]\[data-slot="content"\]/,
    )?.value;
    expect({ triggerSizing, portalLayer }).toMatchObject({
      triggerSizing: expect.stringContaining("--ti-control-height"),
      portalLayer: expect.stringContaining("--ti-layer-popover"),
    });

    const loadingBoundary = postcss.parse(
      read("src/components/UiLoadingBoundary.vue").match(
        /<style[^>]*>([\s\S]*?)<\/style>/,
      )?.[1] ?? "",
    );
    expect(
      declaration(
        loadingBoundary,
        "background",
        /ui-loading-boundary__indicator/,
      )?.value,
    ).toBe("var(--ti-info-bg)");
    expect(
      declaration(loadingBoundary, "color", /ui-loading-boundary__indicator/)
        ?.value,
    ).toBe("var(--ti-info)");
    expect(
      declaration(loadingBoundary, "z-index", /ui-loading-boundary__indicator/)
        ?.value,
    ).toBe("calc(var(--ti-layer-context) + 1)");
  });

  it("keeps component-owned popover and icon visuals portable into the preview", () => {
    const detailPopover = read("src/components/DetailPopover.vue");
    const iconButton = read("src/components/IconButton.vue");
    expect(detailPopover).toContain(".detail-popover-content {");
    expect(detailPopover).toContain("--ti-layer-popover");
    expect(iconButton).toContain(".icon-button :deep(svg)");
    expect(iconButton).toContain(".icon-button-tooltip");
  });
});
