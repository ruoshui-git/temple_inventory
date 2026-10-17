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
  it("uses the sole production visual entry after gallery retirement", () => {
    expect(read("src/main.ts")).toContain('import "./styles/app.css"');
    expect(existsSync(resolve("design-preview.html"))).toBe(false);
    expect(
      Object.keys(JSON.parse(read("package.json")).scripts).some((key) =>
        key.startsWith("design:"),
      ),
    ).toBe(false);
    expect(read("src/styles/app.css").match(/@import/g)).toHaveLength(4);
    for (const path of [
      "src/styles/tokens.css",
      "src/styles/primitives.css",
      "src/style.css",
      "src/loading.css",
    ])
      expect(existsSync(resolve(path)), path).toBe(false);
    expect(read("src/main.ts")).not.toContain("frappe-ui/style.css");
  });

  it("keeps production independent of fixtures and the gallery independent of authentication, RPC and PWA startup", () => {
    const production = importGraph("src/main.ts");
    expect(
      production.some((path) => path.includes("/features/documents/")),
    ).toBe(true);
    expect(
      production.filter((path) => path.includes("/design-preview/")),
    ).toEqual([]);
    expect(
      production.filter((path) =>
        /\/src\/features\/(workspace|history|reconciliation|movement-overview|loan-detail)\//.test(
          path,
        ),
      ),
    ).toEqual([]);
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
      expect(style.getPropertyValue("--p-canvas")).toBe(theme.canvas);
      expect(style.getPropertyValue("--p-radius-card")).toBe(theme.cardRadius);
      expect(style.getPropertyValue("--p-text-scale")).toBe("1.75");
      expect(document.documentElement.dataset.tiTheme).toBe(theme.id);
      for (const color of [theme.ink, theme.muted, theme.accent]) {
        expect(contrast(color, theme.canvas)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      }
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
});
