import {
  expect,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

const isNativeApi = (url: string) =>
  new URL(url).pathname.startsWith("/api/method/temple_inventory.");

async function afterRender(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

export function observeNativeRequests(page: Page) {
  const pending = new Set<Request>();
  const failed: string[] = [];
  const start = (request: Request) => {
    if (isNativeApi(request.url())) pending.add(request);
  };
  const finish = (request: Request) => pending.delete(request);
  const fail = (request: Request) => {
    const error = request.failure()?.errorText;
    if (finish(request) && error !== "net::ERR_ABORTED")
      failed.push(`${new URL(request.url()).pathname}: ${error}`);
  };
  const response = (reply: Response) => {
    if (isNativeApi(reply.url()) && reply.status() >= 400)
      failed.push(`${new URL(reply.url()).pathname}: ${reply.status()}`);
  };
  page.on("request", start);
  page.on("requestfinished", finish);
  page.on("requestfailed", fail);
  page.on("response", response);
  return {
    failed,
    async settled() {
      // Let response handlers render and start any dependent reads before checking.
      await expect
        .poll(
          async () => {
            await afterRender(page);
            return [...pending].map(
              (request) => new URL(request.url()).pathname,
            );
          },
          { message: "in-flight native API requests" },
        )
        .toEqual([]);
    },
    dispose() {
      page.off("request", start);
      page.off("requestfinished", finish);
      page.off("requestfailed", fail);
      page.off("response", response);
    },
  };
}

export async function openNativeRoute(page: Page, path: string) {
  const requests = observeNativeRequests(page);
  try {
    await page.goto(path);
    await expect(
      page.locator("main h1, [data-testid='forbidden-state']").first(),
      path,
    ).toBeVisible();
    // Offscreen thumbnails can stay busy until scrolled into view.
    await expect(
      page.locator(
        "main :is(.document-loading-state, .opening-status, .stock-table-initial-skeleton, .report-initial-skeleton, [aria-busy='true']:not([role='img'])):visible",
      ),
      path,
    ).toHaveCount(0);
    await requests.settled();
  } finally {
    requests.dispose();
  }
}

export async function resizeNativeBrowse(
  page: Page,
  width: number,
  height: number,
) {
  await page.setViewportSize({ width, height });
  const mobile = page.locator(".mobile-app-topbar");
  const desktop = page.locator(".app-sidebar");
  await expect(width < 1024 ? mobile : desktop).toBeVisible();
  await expect(width < 1024 ? desktop : mobile).toBeHidden();
  await afterRender(page);
}
