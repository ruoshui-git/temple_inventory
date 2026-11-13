import { expect, test } from "@playwright/test";
import { mkdirSync, copyFileSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";

// Set D3_EVIDENCE_DIR (e.g. notes/evidence/2026-11-13-d3) to keep a copy of the evidence.
const evidence = process.env.D3_EVIDENCE_DIR;

async function capture(
  page: import("@playwright/test").Page,
  filename: string,
) {
  const path = test.info().outputPath(filename);
  await page.screenshot({ path });
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  copyFileSync(path, `${evidence}/${filename}`);
}

async function watchTransition(
  page: import("@playwright/test").Page,
  selector: string,
) {
  // Overlays animate out on a cloned `.overlay-exit-frame` (the live node is removed at
  // once), while menus and toasts transition in place; accept either signal.
  await page.evaluate((target) => {
    const flags = window as any;
    flags.__d3TransitionObserved = false;
    const node = document.querySelector(target);
    if (node) {
      const onTransitionRun = (event: Event) => {
        if ((event as TransitionEvent).propertyName !== "opacity") return;
        flags.__d3TransitionObserved = true;
        node.removeEventListener("transitionrun", onTransitionRun);
      };
      node.addEventListener("transitionrun", onTransitionRun);
    }
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes)
          if (
            added instanceof HTMLElement &&
            added.classList.contains("overlay-exit-frame")
          ) {
            flags.__d3TransitionObserved = true;
            observer.disconnect();
          }
    });
    observer.observe(document.body, { childList: true });
  }, selector);
}

async function expectTransition(page: import("@playwright/test").Page) {
  await expect
    .poll(() => page.evaluate(() => (window as any).__d3TransitionObserved))
    .toBe(true);
}

test("D3 keyboard, date, resize, motion, and handoff evidence", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await nativeUiSession(page);
  let savedCount: Record<string, unknown> | undefined;
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method =
      new URL(route.request().url()).pathname.split("/").at(-1) || "";
    const args = route.request().postDataJSON() || {};
    calls.push(method);
    if (
      ["session.info", "configuration.status", "browse.bootstrap"].some(
        (name) => method.endsWith(name),
      )
    ) {
      await route.fallback();
      return;
    }
    let message: any = {};
    if (method.endsWith("inventory_page")) {
      message = {
        rows: Array.from({ length: 8 }, (_, i) => ({
          code: `ITEM-${i}`,
          name: `供灯物品${i}`,
          category: "供灯",
          uom: "个",
          available: 4,
          loaned: 0,
          damaged: 0,
          tracksBatch: false,
          tracksExpiry: false,
          image: "",
          locations: [],
        })),
        matched_count: 8,
        next_start: null,
        snapshot: "2026-10-16 12:00:00",
        query: args.query,
        summary: [],
        analysis: { category: [], location: [] },
      };
    } else if (method.endsWith("projections.group_page")) {
      const parentPath = (args.parent_path || []) as string[];
      const field = (args.query?.groupBy?.[0] || "category") as string;
      const groupId = `${field}:供灯`;
      const rows = parentPath.length
        ? Array.from({ length: 8 }, (_, i) => ({
            id: `ITEM-${i}`,
            row_grain: "detail",
            code: `ITEM-${i}`,
            item_code: `ITEM-${i}`,
            item_name: `供灯物品${i}`,
            category: "供灯",
            stock_uom: "个",
            available: 4,
            loaned: 0,
            damaged: 0,
          }))
        : [
            {
              id: groupId,
              row_grain: "group",
              group_depth: 1,
              group_path: [groupId],
              group_label: "供灯",
              group_field: field,
              row_count: 8,
              display_count: 8,
              has_children: true,
              unit_totals: [],
            },
          ];
      message = {
        rows,
        matched_count: parentPath.length ? 8 : 1,
        next_start: null,
        parent_path: parentPath,
        query: args.query,
        row_grain: parentPath.length ? "detail" : "group",
        leaf_columns: [],
      };
    } else if (method.endsWith("operation_page"))
      message = {
        rows: [],
        matched_count: 0,
        next_start: null,
        query: args.query,
        summary: {},
        totals: [],
        analysis: {},
      };
    else if (method.endsWith("table_preferences.get_column_preferences"))
      message = {};
    else if (method.endsWith("editor_clock"))
      message = { timestamp: "2026-10-16 12:00:00" };
    else if (method.endsWith("catalog.operation_items"))
      message = {
        items: [
          {
            item_code: (args.item_codes as string[])?.[0] || "ITEM-A",
            item_name: "供灯物品",
            item_group: "供灯",
            stock_uom: "Nos",
            description: "",
            version: "item-v1",
            has_batch_no: false,
            has_expiry_date: false,
            can_edit: false,
            barcodes: [],
            uoms: [{ uom: "Nos", conversion_factor: 1 }],
            stock: [
              {
                warehouse: "A02-DIRECT",
                warehouse_label: "演示室甲",
                available: 7,
                loaned: 0,
                damaged: 0,
              },
            ],
            attachments: [],
          },
        ],
        errors: [],
      };
    else if (method.endsWith("count_baseline"))
      message = {
        rows: [
          {
            item_code: "ITEM-A",
            item_name: "礼堂椅",
            image: "",
            warehouse: "A02-DIRECT",
            batch_no: null,
            stock_uom: "Nos",
            baseline_qty: 4,
            actual_qty: null,
            review_state: "Unreviewed",
            reason: "",
            needs_review: false,
          },
        ],
        timestamp: args.timestamp,
        warehouses: ["A02-DIRECT"],
        removed_rows: [],
      };
    else if (method.endsWith("save_count"))
      message = savedCount = {
        ...(args.data || {}),
        doctype: "Stock Reconciliation",
        name: "COUNT-DRAFT",
        version: "v1",
        docstatus: 0,
        editable: true,
      };
    // Saving a draft routes the editor to it, which reloads the saved document.
    else if (method.endsWith("load_document") && savedCount)
      message = savedCount;
    else if (method.endsWith("save_operation"))
      message = {
        ...(args.data || {}),
        doctype: "Stock Entry",
        name: "OP-DRAFT",
        version: "v1",
        docstatus: 0,
        editable: true,
      };
    else if (method.endsWith("create_document")) {
      const data = args.data as Record<string, any>;
      message = {
        ...data,
        doctype: "Stock Entry",
        name: "OP-DRAFT",
        version: "v1",
        docstatus: 0,
        editable: true,
        kind: "Receive",
        purpose: "Material Receipt",
        actions: { submit: true },
        items: (data.items || []).map(
          (row: Record<string, any>, index: number) => ({
            ...row,
            name: `OP-ROW-${index}`,
            stock_uom: "Nos",
            transfer_qty: Number(row.qty || 1),
          }),
        ),
      };
    } else if (method.endsWith("submit_document"))
      message = {
        doctype: "Stock Reconciliation",
        name: "COUNT-DRAFT",
        version: "v2",
        docstatus: 1,
        editable: false,
        purpose: "Stock Reconciliation",
        posting_date: "2026-10-15",
        items: [],
        ti_count_review: [],
      };
    else if (method.endsWith("notifications.inbox"))
      message = { items: [], unread_count: 0, has_running_exports: false };
    await route.fulfill({ json: { message } });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/inventory/stock");
  await expect(page.locator("body")).toContainText("供灯物品");

  // Capture the before state at each required viewport.
  const menuTrigger = page.getByRole("button", {
    name: "更多操作",
    exact: true,
  });
  await menuTrigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await capture(page, "popup-menu-before-1440.png");
  await watchTransition(page, "[role='menu']");
  await page.keyboard.press("Escape");
  await expectTransition(page);
  await expect(page.getByRole("menu")).toHaveCount(0);
  const dateButton = page.getByRole("button", { name: /截至/ }).first();
  await dateButton.click();
  const asOfDate = page.getByLabel("截至日期");
  await expect(asOfDate).toBeVisible();
  await capture(page, "date-filter-before-1440.png");
  await asOfDate.fill("2026-10-15");
  await expect(asOfDate).toHaveValue("2026-10-15");
  await asOfDate.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(asOfDate).not.toHaveValue("");
  await asOfDate.fill("2026-10-14");
  await expect(asOfDate).toHaveValue("2026-10-14");
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await dateButton.click();
  await page.getByRole("button", { name: "现在", exact: true }).click();
  await expect(page.locator(".as-of-summary")).toContainText("现在");
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("temple-inventory-toast", {
        detail: { message: "操作已保存", tone: "success", persistent: true },
      }),
    ),
  );
  const toast = page.locator(".notification-toast");
  await expect(toast).toBeVisible();
  await capture(page, "toast-before-1440.png");
  await watchTransition(page, ".notification-toast");
  await toast.getByRole("button").click();
  await expectTransition(page);
  await expect(toast).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("body")).toContainText("供灯物品");
  const phoneActions = page.getByRole("button", {
    name: "更多操作",
    exact: true,
  });
  await phoneActions.click();
  await expect(page.locator(".popup-menu-sheet-content")).toBeVisible();
  await capture(page, "popup-menu-before-390.png");
  await page.getByRole("menuitem", { name: "选择", exact: true }).click();
  await expect(page.locator(".ui-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "已选物品操作" }),
  ).toBeVisible();
  await capture(page, "phone-selection-mode-before-390.png");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("temple-inventory-toast", {
        detail: { message: "操作已保存", tone: "success", persistent: true },
      }),
    ),
  );
  await expect(toast).toBeVisible();
  await capture(page, "toast-before-390.png");
  await toast.getByRole("button").click();
  await expect(toast).toHaveCount(0);
  await page.getByRole("button", { name: /截至/ }).first().click();
  await expect(page.getByLabel("截至日期")).toBeVisible();
  await capture(page, "date-filter-before-390.png");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("region", { name: "已选物品操作" }),
  ).toBeVisible();
  await capture(page, "phone-selection-mode-before-1440.png");
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await page.getByRole("button", { name: /^筛选/ }).click();
  const groupSelect = page
    .locator(".browse-filter-popover .browse-group-by select")
    .first();
  await expect(groupSelect).toBeVisible();
  await groupSelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  const groupButton = page.locator(".data-table-group-toggle").first();
  await expect(groupButton).toBeVisible();
  await groupButton.click();
  await expect(
    page.locator(".data-table-group-detail-row").first(),
  ).toBeVisible();
  await capture(page, "expanded-group-before-1440.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator(".data-table-group-detail-row").first(),
  ).toBeVisible();
  await capture(page, "expanded-group-before-390.png");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("temple-inventory-toast", {
        detail: { message: "减少动画检查", tone: "success", persistent: true },
      }),
    ),
  );
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  const animated = await page
    .locator(".notification-toast, [role=menu]")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        animation: getComputedStyle(node).animationDuration,
        transition: getComputedStyle(node).transitionDuration,
        running: node.getAnimations().length,
      })),
    );
  expect(animated.length).toBeGreaterThan(0);
  expect(
    animated.every(
      ({ animation, transition, running }) =>
        ["0s", "0ms"].includes(animation) &&
        transition
          .split(",")
          .every((duration) => ["0s", "0ms"].includes(duration.trim())) &&
        running === 0,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator(".notification-toast").getByRole("button").click();
  await expect(page.locator(".notification-toast")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(page.locator(".popup-menu-sheet-content")).toBeVisible();
  const reducedSheetMotion = await page
    .locator(".ui-overlay")
    .evaluate((node) => ({
      animation: getComputedStyle(node).animationDuration,
      transition: getComputedStyle(node).transitionDuration,
      running: node.getAnimations().length,
    }));
  expect(reducedSheetMotion.animation).toMatch(/^0(ms|s)$/);
  expect(
    reducedSheetMotion.transition
      .split(",")
      .every((duration) => ["0s", "0ms"].includes(duration.trim())),
  ).toBeTruthy();
  expect(reducedSheetMotion.running).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ui-overlay")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Editors are entered through their shipped routes; keyboard shortcuts must save/confirm drafts.
  const editorRoutes = [
    {
      path: `/inventory/movements/new/Receive?warehouse=A02-DIRECT&items=${encodeURIComponent(JSON.stringify(["ITEM-A"]))}`,
      kind: "operation",
    },
    { path: "/inventory/counts/new", kind: "count" },
  ];
  for (const route of editorRoutes) {
    await page.goto(route.path);
    await expect(page.locator(".form-actions.document-actions")).toBeVisible();
    const isCount = route.kind === "count";
    if (isCount) {
      await page
        .getByRole("button", { name: "指定历史时间", exact: true })
        .click();
      const editorDate = page.getByLabel("操作日期");
      await editorDate.fill("2026-10-15");
      await expect(editorDate).toHaveValue("2026-10-15");
      await editorDate.click();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect(editorDate).not.toHaveValue("");
      const refreshButton = page.getByRole("button", {
        name: "刷新账面",
        exact: true,
      });
      const previousRefreshes = calls.filter((call) =>
        call.endsWith("count_baseline"),
      ).length;
      await refreshButton.click();
      await expect
        .poll(
          () => calls.filter((call) => call.endsWith("count_baseline")).length,
        )
        .toBeGreaterThan(previousRefreshes);
      await expect(refreshButton).toBeEnabled();
      await expect(page.locator(".count-baseline-status")).toHaveCount(0);
      await page.getByLabel("礼堂椅实点数量").fill("6");
    } else {
      await page.getByRole("button", { name: "指定时间", exact: true }).click();
      const editorDate = page.getByLabel("操作日期");
      await editorDate.fill("2026-10-15");
      await expect(editorDate).toHaveValue("2026-10-15");
      await editorDate.focus();
    }
    calls.length = 0;
    await page.keyboard.press("Control+s");
    await expect(page.locator(".notification-toast")).toContainText(
      "已存为草稿单据",
    );
    await page.locator(".notification-toast").getByRole("button").click();
    await expect(page.locator(".notification-toast")).toHaveCount(0);
    calls.length = 0;
    // The count editor handles Ctrl/⌘+Enter at document level; after a draft save the
    // reviewed row may be filtered out, so only the operation editor needs a focus target.
    if (isCount) {
      // The mocked reload does not round-trip review state, so count the row again.
      await page.getByLabel("礼堂椅实点数量").fill("6");
      await page.getByLabel("礼堂椅实点数量").blur();
    } else await page.locator('[data-field="postingDate"]').focus();
    await page.keyboard.press("Control+Enter");
    if (isCount) {
      const dialog = page.locator(".ui-overlay");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(dialog).toBeVisible();
      const normalDialogMotion = await dialog.evaluate((node) => ({
        animation: getComputedStyle(node).animationDuration,
        transition: getComputedStyle(node).transitionDuration,
      }));
      expect(normalDialogMotion.animation).not.toMatch(/^0(ms|s)$/);
      await capture(page, "confirmation-dialog-1440.png");
      await dialog.locator(".ui-dialog").focus();
      await watchTransition(page, ".ui-overlay");
      await page.keyboard.press("Escape");
      await expectTransition(page);
      await expect(dialog).toHaveCount(0);
      await page.keyboard.press("Control+Enter");
      await expect(dialog).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reducedDialogMotion = await dialog.evaluate((node) => ({
        animation: getComputedStyle(node).animationDuration,
        transition: getComputedStyle(node).transitionDuration,
        running: node.getAnimations().length,
      }));
      expect(reducedDialogMotion.animation).toMatch(/^0(ms|s)$/);
      expect(
        reducedDialogMotion.transition
          .split(",")
          .every((duration) => ["0s", "0ms"].includes(duration.trim())),
      ).toBeTruthy();
      expect(reducedDialogMotion.running).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, "confirmation-dialog-390.png");
      await dialog.locator(".ui-dialog").focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(() => calls.some((call) => call.endsWith("submit_document")))
        .toBeTruthy();
      await expect(dialog).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 900 });
    } else {
      await expect(page.locator(".ui-overlay")).toBeVisible();
      await page.locator(".ui-dialog").focus();
      await page.keyboard.press("Escape");
      await expect(page.locator(".ui-overlay")).toHaveCount(0);
    }
  }

  await page.goto("/inventory/stock");
  const handle = page.locator(".data-table-resize-handle").first();
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const before = await page
    .locator("thead th")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 60, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await page
    .locator("thead th")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator(".data-table-resize-handle").first()).toBeVisible();
  const persisted = await page
    .locator("thead th")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(persisted).toBeCloseTo(after, 0);
});

test("phone /inventory/stock → 更多操作 → 选择 fades the sheet before removing it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page",
    (route) =>
      route.fulfill({
        json: {
          message: {
            rows: [
              {
                code: "ITEM-A",
                name: "供灯用品",
                category: "供灯",
                uom: "个",
                available: 4,
                loaned: 0,
                damaged: 0,
                tracksBatch: false,
                tracksExpiry: false,
                image: "",
                locations: [],
              },
            ],
            matched_count: 1,
            next_start: null,
            snapshot: "2026-10-16 12:00:00",
            query: {},
            summary: [],
            analysis: { category: [], location: [] },
          },
        },
      }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inventory/stock");
  await expect(page.getByText("供灯用品", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(page.locator(".popup-menu-sheet-content")).toBeVisible();
  await watchTransition(page, ".ui-overlay");
  await page.getByRole("menuitem", { name: "选择", exact: true }).click();
  await expectTransition(page);
  await expect(page.locator(".ui-overlay")).toHaveCount(0);
});
