import {
  test as base,
  expect,
  type Page,
  type Locator,
} from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
export { expect, type Page, type Locator };
export const test = base.extend<{ galleryFonts: void }>({
  galleryFonts: [
    async ({ page }, use) => {
      const path =
        process.env.AUDIT_CJK_FONT ||
        "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf";
      if (existsSync(path)) {
        await page.route("**/__gallery-audit-font.otf", (route) =>
          route.fulfill({ body: readFileSync(path), contentType: "font/otf" }),
        );
        await page.addInitScript(() => {
          document.addEventListener("DOMContentLoaded", () => {
            const style = document.createElement("style");
            style.textContent =
              '@font-face {font-family:GalleryAudit;src:url("/__gallery-audit-font.otf")} body,button,input,select,textarea {font-family:GalleryAudit,sans-serif!important}';
            document.head.append(style);
          });
        });
      }
      await use();
    },
    { auto: true },
  ],
});
export async function largePicker(page: Page) {
  await page.evaluate(async () => {
    (
      await import("/src/design-preview/usabilityFixtures.ts")
    ).installLargePickerFixture();
    (
      await import("/src/design-preview/fixtureServices.ts")
    ).fixtureScenarios.pickerPageSize = 2000;
  });
}
export async function failNextCall(page: Page, endpoint: string) {
  await page.evaluate(async (endpoint) => {
    (
      await import("/src/design-preview/fixtureServices.ts")
    ).fixtureScenarios.failEndpoint = endpoint;
  }, endpoint);
}
