import { mkdir, writeFile } from "node:fs/promises";
import {
  chromium,
  expect,
} from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
import { base, launch, login } from "../lib.mjs";

const output = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t7";
await mkdir(output, { recursive: true });
const browser = await launch();
const token = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
const batchCodes = [1, 2, 3].map((n) => `T4VIS-B-${token}-${n}`);
const plainCodes = [1, 2, 3].map((n) => `T4VIS-P-${token}-${n}`);
const codes = [...batchCodes, ...plainCodes];
let unit = "";
const draftNames = new Set();
const batchNames = new Set();
const timings = {};
let unitCreated = false;
let bootstrap;
let csrf = "";
let desktopContext;
let desktop;
let phoneContext;
let phone;

async function api(page, method, data = {}) {
  return page.evaluate(
    async ({ method, data, csrf }) => {
      const response = await fetch(`/api/method/temple_inventory.${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": csrf,
          "X-Inventory-Account": "Administrator",
        },
        body: JSON.stringify(data),
      });
      const body = await response.json();
      if (!response.ok || body.exc_type)
        throw new Error(
          `${method}: ${response.status} ${body.exception || body.exc_type || ""}`,
        );
      return body.message;
    },
    { method, data, csrf },
  );
}

async function apiGet(page, method) {
  return page.evaluate(async (method) => {
    const response = await fetch(`/api/method/temple_inventory.${method}`);
    const body = await response.json();
    if (!response.ok || body.exc_type)
      throw new Error(
        `${method}: ${response.status} ${body.exception || body.exc_type || ""}`,
      );
    return body.message;
  }, method);
}

async function directDelete(page, doctype, name) {
  const response = await page.evaluate(
    async ({ doctype, name, csrf }) =>
      fetch("/api/method/frappe.client.delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": csrf,
        },
        body: JSON.stringify({ doctype, name }),
      }).then((result) => ({ ok: result.ok, status: result.status })),
    { doctype, name, csrf },
  );
  if (!response.ok)
    throw new Error(`cleanup ${doctype} ${name}: ${response.status}`);
}

function editorUrl(codesToAdd = codes.slice(0, 5)) {
  const query = new URLSearchParams({
    warehouse: bootstrap.physical_leaves[0],
    items: JSON.stringify(codesToAdd),
  });
  return `/inventory/movements/new/Receive?${query}`;
}

async function chooseWarehouse(page, locator, name) {
  const row = bootstrap.warehouses.find((candidate) => candidate.name === name);
  const label = row?.label || name;
  const current = await locator.inputValue().catch(() => "");
  if (current === label || current.startsWith(`${label} `)) return;
  await locator.fill(label);
  await page.getByRole("option").filter({ hasText: label }).first().click();
}

async function screenshot(page, name) {
  const path = `${output}/${name}.jpg`;
  await page.screenshot({ path, fullPage: false, animations: "disabled", type: "jpeg", quality: 80 });
  timings.screenshots ||= [];
  timings.screenshots.push(name);
  return path;
}

async function resetScroll(page) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    await new Promise(requestAnimationFrame);
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll("*")) {
      if (element.scrollTop) element.scrollTop = 0;
      if (element.scrollLeft) element.scrollLeft = 0;
    }
    await new Promise(requestAnimationFrame);
  });
}

try {
  desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    serviceWorkers: "block",
  });
  desktop = await desktopContext.newPage();
  desktop.setDefaultTimeout(15000);
  await login(desktop);
  const session = await apiGet(desktop, "session.info");
  csrf = session.csrf_token;
  bootstrap = await api(desktop, "browse.bootstrap");
  const existingBox = bootstrap.uoms.find(
    (candidate) => candidate.name === "箱",
  );
  unit = existingBox?.name || `箱${token.slice(0, 4)}`;

  for (const [index, code] of batchCodes.entries()) {
    await api(desktop, "catalog.save_item", {
      data: {
        item_code: code,
        item_name: `T4 批次物品 ${index + 1} ${token}`,
        stock_uom: "Nos",
        has_batch_no: 1,
        has_expiry_date: 1,
      },
    });
  }
  for (const [index, code] of plainCodes.entries()) {
    await api(desktop, "catalog.save_item", {
      data: {
        item_code: code,
        item_name: `T4 普通物品 ${index + 1} ${token}`,
        stock_uom: "Nos",
        has_batch_no: 0,
        has_expiry_date: 0,
      },
    });
  }
  if (!existingBox) {
    await api(desktop, "catalog.create_uom", {
      label: unit,
      must_be_whole_number: true,
    });
    unitCreated = true;
  }

  await desktop.goto(new URL(editorUrl(), base).href);
  await expect(desktop.locator(".allocation-card")).toHaveCount(5);
  const receiveLocation = desktop.getByRole("combobox", { name: /入库位置/ });
  await chooseWarehouse(desktop, receiveLocation, bootstrap.physical_leaves[0]);
  for (const code of batchCodes) {
    const card = desktop.locator(".allocation-card").filter({ hasText: code });
    await expect(
      card.getByRole("button", { name: "+ 添加批次" }),
    ).toBeVisible();
    await card.locator('input[data-field="expiry"]').fill("2099-04-01");
  }
  await resetScroll(desktop);
  await screenshot(desktop, "desktop-receive-3-batch-2-plain");

  await desktop.locator(".allocation-card").last().scrollIntoViewIfNeeded();
  await screenshot(desktop, "desktop-toolbar-sticky-scrolled");

  const firstBatchCard = desktop
    .locator(".allocation-card")
    .filter({ hasText: batchCodes[0] });
  await firstBatchCard.scrollIntoViewIfNeeded();
  const unitSelect = firstBatchCard.getByRole("combobox", { name: "单位" });
  await unitSelect.fill("设置换算");
  await desktop.getByRole("option", { name: "设置换算…", exact: true }).click();
  let conversion = desktop.getByRole("dialog").last();
  const conversionUnit = conversion.getByRole("combobox", { name: /输入单位/ });
  await conversionUnit.fill(unit);
  await desktop.getByRole("option", { name: unit, exact: true }).click();
  const factor = conversion.locator('[data-field="conversionFactor"]');
  await factor.fill("12");
  await screenshot(desktop, "conversion-dialog-before-apply");
  await conversion.getByRole("button", { name: "应用换算" }).click();
  await expect(
    firstBatchCard.locator('input[data-field="qty"]').first(),
  ).toBeFocused();
  await screenshot(desktop, "conversion-after-apply-focus-quantity");

  await firstBatchCard.getByRole("combobox", { name: "单位" }).fill("设置换算");
  await desktop.getByRole("option", { name: "设置换算…", exact: true }).click();
  conversion = desktop.getByRole("dialog").last();
  const replacementUnit = conversion.getByRole("combobox", {
    name: /输入单位/,
  });
  await replacementUnit.fill(unit);
  await desktop.getByRole("option", { name: unit, exact: true }).click();
  const replacementFactor = conversion.locator(
    '[data-field="conversionFactor"]',
  );
  await replacementFactor.fill("13");
  await expect(conversion.getByText(/将替换原换算：1/)).toBeVisible();
  await screenshot(desktop, "conversion-replacement-warning");
  await conversion.getByRole("button", { name: "关闭对话框" }).click();
  const dirtyConfirm = desktop.getByRole("alertdialog");
  await expect(dirtyConfirm).toBeVisible();
  await screenshot(desktop, "conversion-dirty-close-confirm");
  await dirtyConfirm.getByRole("button", { name: "继续填写换算" }).click();
  conversion = desktop.getByRole("dialog").last();
  await conversion.getByRole("button", { name: "关闭对话框" }).click();
  await desktop
    .getByRole("alertdialog")
    .getByRole("button", { name: "放弃换算并关闭" })
    .click();

  await desktop
    .locator(".preview-line-toolbar")
    .getByRole("button", { name: "添加物品" })
    .click();
  const picker = desktop.getByRole("dialog").last();
  await picker
    .getByRole("searchbox", { name: /搜索物品名称/ })
    .fill(plainCodes[2]);
  const selectedRow = picker
    .getByRole("row")
    .filter({ hasText: plainCodes[2] });
  await expect(selectedRow).toBeVisible();
  await selectedRow.getByRole("checkbox").check();
  const pendingStart = Date.now();
  await picker.getByRole("button", { name: /添加所选/ }).click();
  await expect(picker).toBeHidden({ timeout: 10000 });
  await expect(
    desktop.locator(".allocation-card").filter({ hasText: plainCodes[2] }),
  ).toHaveClass(/allocation-card--recent/, { timeout: 10000 });
  timings.multiAddHydrationMs = Date.now() - pendingStart;
  timings.multiAddSkeletonObserved = await desktop
    .getByText("正在载入物品资料…")
    .isVisible()
    .catch(() => false);
  if (timings.multiAddSkeletonObserved)
    await screenshot(desktop, "desktop-multi-add-pending-skeleton");
  await expect(desktop.locator(".allocation-card").first()).toContainText(
    plainCodes[2],
  );
  await resetScroll(desktop);
  await screenshot(desktop, "desktop-new-card-highlighted-at-top");

  const addRows = desktop
    .locator(".allocation-card")
    .filter({ hasText: plainCodes[2] });
  await expect(addRows).toHaveCount(1);
  await desktop.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(desktop).toHaveURL(/\/inventory\/movements\/MAT-STE-/);
  const draftName = decodeURIComponent(
    new URL(desktop.url()).pathname.split("/").at(-1),
  );
  const doc = await api(desktop, "native_api.load_document", {
    doctype: "Stock Entry",
    name: draftName,
  });
  draftNames.add(draftName);
  for (const row of doc.items) if (row.batch_no) batchNames.add(row.batch_no);
  if (doc.items.length !== 6)
    throw new Error(`expected 6 draft lines; got ${doc.items.length}`);

  let releaseHydration;
  const hydrationGate = new Promise((resolve) => (releaseHydration = resolve));
  let hydrationRequestAt = 0;
  await desktop.route(
    "**/api/method/temple_inventory.catalog.operation_items",
    async (route) => {
      hydrationRequestAt = Date.now();
      await hydrationGate;
      await route.continue();
    },
  );
  const requestStarted = desktop.waitForRequest((request) =>
    request.url().includes("temple_inventory.catalog.operation_items"),
  );
  const reloadStarted = Date.now();
  await resetScroll(desktop);
  await desktop.reload({ waitUntil: "domcontentloaded" });
  await requestStarted;
  await expect(desktop.getByText("正在载入物品资料…")).toBeVisible();
  const incompleteLabel = await desktop
    .locator(".preview-line-toolbar-status button")
    .last()
    .textContent();
  timings.hydratingIssueStatus = incompleteLabel?.trim() || "";
  if (!incompleteLabel?.trim().startsWith("0 处待完善"))
    throw new Error(
      `hydrating rows showed premature issues: ${incompleteLabel}`,
    );
  await expect(desktop.locator(".operation-line-skeleton")).toHaveCount(6);
  await screenshot(desktop, "desktop-reopen-six-lines-hydrating");
  releaseHydration();
  await expect(desktop.locator(".allocation-card")).toHaveCount(6, {
    timeout: 30000,
  });
  timings.reopenHydrationMs = Date.now() - reloadStarted;
  timings.operationItemsRequestMs = hydrationRequestAt - reloadStarted;
  await desktop.unrouteAll({ behavior: "wait" });

  const invalidBatchCard = desktop
    .locator(".allocation-card")
    .filter({ hasText: batchCodes[0] });
  const invalidRow = invalidBatchCard
    .locator(".batch-subrow:not(.batch-subrow--header)")
    .first();
  await invalidRow
    .locator('input[data-field="manufacturingDate"]')
    .fill("2026-10-27");
  await invalidRow.locator('input[data-field="expiry"]').fill("2026-01-01");
  await desktop
    .getByRole("button", { name: "复核并确认", exact: true })
    .click();
  await expect(invalidRow.getByRole("alert")).toContainText(
    "到期日期不能早于生产日期",
  );
  await screenshot(desktop, "desktop-validation-error-on-batch-subrow");

  phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "zh-CN",
    serviceWorkers: "block",
  });
  phone = await phoneContext.newPage();
  phone.setDefaultTimeout(15000);
  await login(phone);
  await phone.goto(new URL(editorUrl(), base).href);
  await expect(phone.locator(".allocation-card")).toHaveCount(5);
  console.log("phone-card-geometry", JSON.stringify(await phone.locator(".allocation-card").first().evaluate((card) => Object.fromEntries([".allocation-card-heading", ".allocation-identity", ".preview-line-identity", ".allocation-card-total"].map((selector) => { const node = card.querySelector(selector); const rect = node.getBoundingClientRect(); return [selector, { x: rect.x, width: rect.width, height: rect.height, display: getComputedStyle(node).display, grid: getComputedStyle(node).gridTemplateColumns, flex: getComputedStyle(node).flex }]; })))));
  const phoneDestination = phone.getByRole("combobox", { name: /入库位置/ });
  await chooseWarehouse(phone, phoneDestination, bootstrap.physical_leaves[0]);
  await screenshot(phone, "phone-receive-top-390x844");
  const phoneActions = phone.locator(".preview-document-actions");
  await expect(
    phoneActions.getByRole("button", { name: "添加物品" }),
  ).toBeVisible();
  const phoneActionBar = await phoneActions.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const ancestors = [];
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.transform !== "none" || parentStyle.zoom !== "1") {
        const parentRect = parent.getBoundingClientRect();
        ancestors.push({
          tag: parent.tagName,
          className:
            typeof parent.className === "string" ? parent.className : "",
          transform: parentStyle.transform,
          zoom: parentStyle.zoom,
          x: Math.round(parentRect.x),
          y: Math.round(parentRect.y),
          width: Math.round(parentRect.width),
          height: Math.round(parentRect.height),
        });
      }
    }
    return {
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      position: style.position,
      display: style.display,
      bottom: style.bottom,
      taskEditor: document
        .querySelector(".preview-workspace")
        ?.classList.contains("is-task-editor"),
      navigationHeight: getComputedStyle(document.documentElement)
        .getPropertyValue("--preview-nav-height")
        .trim(),
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualWidth: window.visualViewport?.width,
        visualHeight: window.visualViewport?.height,
        visualScale: window.visualViewport?.scale,
      },
      ancestors,
    };
  });
  const actionHeights = await phoneActions
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) =>
        Math.round(button.getBoundingClientRect().height),
      ),
    );
  if (actionHeights.some((height) => height < 44))
    throw new Error(
      `phone action button below 44px: ${actionHeights.join(",")}`,
    );
  await phone
    .locator(".batch-subrow:not(.batch-subrow--header)")
    .first()
    .scrollIntoViewIfNeeded();
  await screenshot(phone, "phone-batch-subrow-cards-390x844");
  await resetScroll(phone);

  await phone.setViewportSize({ width: 390, height: 500 });
  const phoneQty = phone
    .locator(".allocation-card")
    .filter({ hasText: plainCodes[0] })
    .locator('input[data-field="qty"]');
  await phoneQty.focus();
  await phone.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("VisualViewport unavailable");
    Object.defineProperty(viewport, "height", {
      configurable: true,
      value: 180,
    });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(phoneActions).toHaveClass(/is-keyboard-open/);
  await expect(phone.locator(".preview-line-toolbar")).toHaveClass(
    /is-keyboard-open/,
  );
  await screenshot(phone, "phone-keyboard-open-390x500");

  await writeFile(
    `${output}/timings.json`,
    JSON.stringify(timings, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { codes, unit, draftName, phoneActionBar, timings },
      null,
      2,
    ),
  );
} finally {
  if (desktop) {
    for (const name of draftNames) {
      try {
        const current = await api(desktop, "native_api.load_document", {
          doctype: "Stock Entry",
          name,
        });
        if (current.docstatus === 0)
          await api(desktop, "native_api.delete_document", {
            doctype: "Stock Entry",
            name,
            version: current.version,
          });
      } catch (error) {
        console.warn(`draft cleanup failed: ${String(error)}`);
      }
    }
    for (const name of batchNames) {
      try {
        await directDelete(desktop, "Batch", name);
      } catch (error) {
        console.warn(`batch cleanup failed: ${String(error)}`);
      }
    }
    for (const code of codes) {
      try {
        await directDelete(desktop, "Item", code);
      } catch (error) {
        console.warn(`item cleanup failed: ${String(error)}`);
      }
    }
    if (unitCreated) {
      try {
        await directDelete(desktop, "UOM", unit);
      } catch (error) {
        console.warn(`UOM cleanup failed: ${String(error)}`);
      }
    }
  }
  await phoneContext?.close();
  await desktopContext?.close();
  await browser.close();
}
