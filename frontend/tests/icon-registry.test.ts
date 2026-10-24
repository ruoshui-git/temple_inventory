import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kindIcons } from "../src/lib/kindIcons";

const root = join(process.cwd(), "src");
const readTree = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    return entry.isDirectory()
      ? readTree(filename)
      : /\.(vue|ts)$/.test(entry.name)
        ? [filename]
        : [];
  });
const files = readTree(root);
const registry = readFileSync(
  join(root, "components/InventoryIcon.vue"),
  "utf8",
);

describe("InventoryIcon registry", () => {
  it("keeps every canonical glyph unique and aliases explicit", () => {
    const paths = [
      ...registry.matchAll(/^\s*["']?([\w-]+)["']?:\s*"([^"]+)"[,]?/gm),
    ];
    const aliasesBlock =
      registry.match(/const aliases:[^=]+=\s*\{([^}]+)\}/)?.[1] || "";
    const aliases = Object.fromEntries(
      [...aliasesBlock.matchAll(/([\w-]+): "([\w-]+)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    const glyphs = paths.map((match) => match[2]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const target of Object.values(aliases))
      expect(paths.some((match) => match[1] === target)).toBe(true);
  });

  it("defines every statically referenced icon name", () => {
    const names = new Set([
      ...[...registry.matchAll(/^\s*["']?([\w-]+)["']?:\s*"[^"]+"[,]?/gm)].map(
        (match) => match[1],
      ),
      ...Object.values(kindIcons).map((entry) => entry.icon),
      ...files.flatMap((filename) => {
        const source = readFileSync(filename, "utf8");
        return [
          ...source.matchAll(
            /<InventoryIcon\b[^>]*?(?<!:)\bname\s*=\s*["']([\w-]+)["']/gs,
          ),
          ...source.matchAll(/(?<!:)\bicon\s*=\s*["']([\w-]+)["']/g),
          ...source.matchAll(/:icon\s*=\s*["']'([\w-]+)'["']/g),
          ...source.matchAll(/\bicon\s*:\s*["']([\w-]+)["']/g),
        ].map((match) => match[1] || match[2]);
      }),
    ]);
    const registered = new Set(
      [...registry.matchAll(/^\s*["']?([\w-]+)["']?:\s*"[^"]+"[,]?/gm)].map(
        (match) => match[1],
      ),
    );
    for (const name of names)
      expect(
        name === "trash" || registered.has(name),
        `${name} must exist`,
      ).toBe(true);
  });

  it("maps each movement kind and Reconcile to a distinct glyph", () => {
    const icons = Object.values(kindIcons).map((entry) => entry.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
