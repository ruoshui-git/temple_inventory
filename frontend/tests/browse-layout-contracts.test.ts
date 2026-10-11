import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\s+/g, " ");

describe("browse page layout contracts", () => {
  it("keeps Loans search flexible and actions grouped at the right", () => {
    const view = source("src/features/loans/LoansView.vue");
    expect(view).toContain('class="loan-toolbar-actions"');
    expect(view).toMatch(
      /\.loan-browse \.desktop-list-layout \{[^}]*width: 100%;[^}]*min-width: 0;/,
    );
    expect(view).toMatch(
      /\.loan-browse \.results-column \{[^}]*width: 100%;[^}]*min-width: 0;/,
    );
    expect(view).toMatch(
      /\.loan-browse \.result-toolbar \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/,
    );
    expect(view).toMatch(
      /\.loan-browse-header \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*align-items: stretch;[^}]*justify-content: stretch;/,
    );
    expect(view).toMatch(
      /\.loan-search \{[^}]*min-width: 0;[^}]*flex: 1 1 auto;/,
    );
    expect(view).toMatch(/\.loan-toolbar-actions \{[^}]*margin-left: auto;/);
  });

  it("keeps the Expiry result summary as the right-side metadata item", () => {
    const view = source("src/features/expiry/ExpiryDesktopView.vue");
    const styles = source("src/features/expiry/expiry-surface.css");
    expect(view).toContain('class="expiry-result-count"');
    expect(styles).toMatch(
      /\.inventory-filter-strip \.expiry-result-count \{[^}]*flex: 0 0 auto;[^}]*margin-left: auto;/,
    );
  });
});
