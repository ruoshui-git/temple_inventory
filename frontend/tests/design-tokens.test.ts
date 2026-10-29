import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(css|vue|ts)$/.test(name) ? [path] : [];
  });
}

it("defines every design token the frontend uses", () => {
  const files = sources(join(__dirname, "../src")).map((path) =>
    readFileSync(path, "utf8"),
  );
  const text = files.join("\n");
  const used = new Set(
    [...text.matchAll(/var\((--p-[a-z0-9-]+)/g)].map((match) => match[1]),
  );
  const defined = new Set(
    [...text.matchAll(/(--p-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
  expect([...used].filter((token) => !defined.has(token!))).toEqual([]);
});
