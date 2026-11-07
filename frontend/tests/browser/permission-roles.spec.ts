import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

for (const role of ["Viewer", "Operator", "Manager"] as const) {
  for (const width of [1440, 390]) {
    test(`${role} permission pages at ${width}px`, async ({ page }, info) => {
      await nativeUiSession(page, 100, {}, role);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      const readablePages = [
        "/inventory/",
        "/inventory/stock",
        "/inventory/stock/items/TEST-ITEM",
        "/inventory/movements/TEST-ENTRY",
        "/inventory/drafts",
        "/inventory/activities",
        "/inventory/activity-types",
        "/inventory/stock/units",
        "/inventory/stock/categories",
        "/inventory/stock/warehouses",
        "/inventory/stock/warehouses/ROOM-A",
        "/inventory/stock/damaged",
        "/inventory/loans",
        "/inventory/more",
      ];
      for (const path of readablePages) {
        await page.goto(path);
        await expect(
          page.locator(".app-shell, .app-content").first(),
        ).toBeVisible();
        await expect(page.getByTestId("forbidden-state")).toHaveCount(0);
        if (role === "Viewer" && path === "/inventory/stock") {
          await expect(
            page.getByRole("button", { name: "选择", exact: true }),
          ).toHaveCount(0);
          await expect(page.locator(".selection-bar")).toHaveCount(0);
        }
      }

      const directRoutes = [
        ["/inventory/movements/new/Receive", "stock_entry.create"],
        ["/inventory/counts/new", "stock_reconciliation.create"],
        ["/inventory/stock/items/new", "item.create"],
      ] as const;
      const allowed: Record<string, string[]> = {
        Viewer: [],
        Operator: ["stock_entry.create", "item.create"],
        Manager: [
          "stock_entry.create",
          "stock_reconciliation.create",
          "item.create",
        ],
      };
      for (const [path, capability] of directRoutes) {
        await page.goto(path);
        if (allowed[role].includes(capability))
          await expect(page.getByTestId("forbidden-state")).toHaveCount(0);
        else await expect(page.getByTestId("forbidden-state")).toBeVisible();
        await expect(
          width === 390
            ? page.locator(".app-mobile-nav")
            : page.getByRole("navigation", { name: "应用主导航" }),
        ).toBeVisible();
      }

      if (role === "Operator") {
        const writes: string[] = [];
        page.on("request", (request) => {
          if (
            /native_api\.(save|submit|cancel|amend|delete)_document/.test(
              request.url(),
            )
          )
            writes.push(request.url());
        });
        await page.goto("/inventory/counts/TEST-COUNT");
        await expect(page.getByTestId("forbidden-state")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "核对并确认" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("spinbutton", { name: /实点数量/ }),
        ).toHaveCount(0);
        expect(writes).toEqual([]);
      }
      if (role === "Viewer") {
        const writes: string[] = [];
        page.on("request", (request) => {
          if (
            /native_api\.(save|submit|cancel|amend|delete)_document/.test(
              request.url(),
            )
          )
            writes.push(request.url());
        });
        await page.goto("/inventory/movements/TEST-ENTRY");
        for (const label of [
          "编辑",
          "确认",
          "取消记录",
          "创建修订草稿",
          "删除草稿单据",
          "复制为新草稿",
        ])
          await expect(
            page.getByRole("button", { name: label, exact: true }),
          ).toHaveCount(0);
        await page
          .getByRole("button", { name: "更多操作", exact: true })
          .click();
        await expect(
          page.getByRole("menuitem", { name: "打印", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("menuitem", { name: "下载 PDF", exact: true }),
        ).toBeVisible();
        expect(writes).toEqual([]);
      }
      if (role === "Manager") {
        await page.goto("/inventory/movements/TEST-SUBMITTED");
        await expect(
          page.getByRole("button", { name: "取消记录", exact: true }),
        ).toBeVisible();
        await page.goto("/inventory/stock/warehouses");
        await expect(
          page.getByRole("button", {
            name: /新建位置|添加区域|添加房间|添加货位/,
          }),
        ).toHaveCount(0);
        await page.goto("/inventory/stock/warehouses/ROOM-A");
        await expect(
          page.getByRole("button", {
            name: /重命名|移动|停用|启用|细分|添加区域/,
          }),
        ).toHaveCount(0);
        await page.goto("/inventory/stock/items/TEST-ITEM");
        await expect(
          page.getByRole("button", { name: "删除物品" }),
        ).toHaveCount(0);
      }
      await page.goto("/inventory/");
      await page.screenshot({
        path: info.outputPath(`${role.toLowerCase()}-${width}.png`),
      });
    });
  }
}
