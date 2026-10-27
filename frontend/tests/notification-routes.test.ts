import { describe, expect, it } from "vitest";
import { routeRegistry } from "../src/lib/routeRegistry";

function matchesRoute(path: string) {
  return routeRegistry.find((route) => {
    const pattern = route.path.replace(/:[^/]+/g, "[^/]+");
    return new RegExp(`^${pattern}/?$`).test(path);
  });
}

describe("notification links", () => {
  it("resolves every SPA notification path to a named route", () => {
    const patterns = [
      "/movements/STE-test",
      "/counts/REC-test",
      "/reports",
      "/stock/expiry",
    ];
    for (const path of patterns) {
      expect(matchesRoute(path)?.name, path).toBeTruthy();
    }
  });
});
