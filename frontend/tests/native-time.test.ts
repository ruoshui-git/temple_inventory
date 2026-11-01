import { describe, expect, it } from "vitest";
import {
  formatSiteDateTime,
  formatSiteTime,
  postingTime,
} from "../src/lib/nativeTime";

describe("native site time display", () => {
  it("pads hours, keeps seconds, and strips fractional precision", () => {
    expect(formatSiteTime("6:07:08.123456")).toBe("06:07:08");
    expect(formatSiteDateTime("2026-10-31 6:07:08.123456")).toBe(
      "2026-10-31 06:07:08",
    );
    expect(postingTime("6:07:08.123456")).toBe("06:07:08");
  });

  it("returns empty display text for invalid values", () => {
    expect(formatSiteTime("bad")).toBe("");
    expect(formatSiteDateTime("bad")).toBe("");
  });

  it("renders explicit instants in the supplied site timezone", () => {
    expect(
      formatSiteDateTime("2026-10-31T10:07:00.123Z", "America/Halifax"),
    ).toBe("2026-10-31 07:07:00");
  });
});
