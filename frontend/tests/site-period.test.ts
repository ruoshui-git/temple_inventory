import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSitePeriod } from "../src/lib/sitePeriod";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/periods.json", import.meta.url), "utf8"),
) as {
  site_date: string;
  periods: Record<string, { from: string; to: string }>;
};

describe("shared site period expectations", () => {
  it.each(Object.entries(fixture.periods))("resolves %s", (key, expected) => {
    expect(
      resolveSitePeriod(
        {
          key: key as keyof typeof fixture.periods,
          from: expected.from,
          to: expected.to,
        },
        fixture.site_date,
      ),
    ).toEqual(expected);
  });
});
