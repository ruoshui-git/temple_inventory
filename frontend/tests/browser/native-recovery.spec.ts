import { expect, test, type Page } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

// Real browser storage and routed production controllers; controlled HTTP data.
// These checks do not claim real-server authentication or stock writes.
async function prepare(page: Page, account = "manager") {
  await page.route("**/api/method/temple_inventory.**", (route) =>
    route.fulfill({ status: 500, json: { exc_type: "UnexpectedRequest" } }),
  );
  await nativeUiSession(page, 100, {
    user: account,
    capabilities: { "Stock Entry": { create: true, write: true } },
    operations: { Receive: true },
  });
  await page.route("**/api/method/temple_inventory.session.info", (route) =>
    route.fulfill({
      json: {
        message: {
          user: account,
          csrf_token: "recovery-browser-test",
          ui_preferences: {
            theme: "jade",
            density: "balanced",
            textScale: 100,
          },
        },
      },
    }),
  );
}

async function open(page: Page) {
  await page.goto("/inventory/new/Receive");
  await page.getByText("补充记录（可选）", { exact: true }).click();
  await expect(page.getByLabel("来源", { exact: true })).toBeVisible();
}

async function snapshots(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("temple-inventory:recovery:v1:"))
      .map((key) => JSON.parse(localStorage.getItem(key)!)),
  );
}

test("incomplete input survives reload only after an explicit recovery choice", async ({
  page,
}) => {
  await prepare(page);
  await open(page);
  await page.getByLabel("来源", { exact: true }).fill("恢复验收：尚未添加物品");
  await expect.poll(async () => (await snapshots(page)).length).toBe(1);
  await page.reload();
  await page.getByText("补充记录（可选）", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "此浏览器的未完成输入" }),
  ).toBeVisible();
  await expect(page.getByLabel("来源", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "检查并恢复", exact: true }).click();
  await expect(page.getByLabel("来源", { exact: true })).toHaveValue(
    "恢复验收：尚未添加物品",
  );
  await expect(
    page.getByText("尚未创建原生记录", { exact: true }).first(),
  ).toBeVisible();
});

test("two tabs retain independent incomplete editors", async ({
  page,
  context,
}) => {
  await prepare(page);
  await open(page);
  await page.getByLabel("来源", { exact: true }).fill("甲窗口未完成输入");
  const second = await context.newPage();
  await prepare(second);
  await open(second);
  await second.getByLabel("来源", { exact: true }).fill("乙窗口未完成输入");
  await expect.poll(async () => (await snapshots(page)).length).toBe(2);
  const saved = await snapshots(page);
  expect(new Set(saved.map((row) => row.editorId)).size).toBe(2);
  expect(new Set(saved.map((row) => row.tabId)).size).toBe(2);
  expect(saved.map((row) => row.values.source).sort()).toEqual(
    ["乙窗口未完成输入", "甲窗口未完成输入"].sort(),
  );
  await expect(page.getByLabel("来源", { exact: true })).toHaveValue(
    "甲窗口未完成输入",
  );
});

test("another account cannot offer or hydrate the previous account's input", async ({
  page,
}) => {
  await prepare(page);
  await open(page);
  await page.getByLabel("来源", { exact: true }).fill("仅限甲账户");
  await expect.poll(async () => (await snapshots(page)).length).toBe(1);
  await prepare(page, "other-manager");
  await page.reload();
  await page.getByText("补充记录（可选）", { exact: true }).click();
  await expect(page.getByLabel("来源", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "检查并恢复", exact: true }),
  ).toHaveCount(0);
  expect((await snapshots(page))[0].account).toBe("manager");
});

test("pending uploads recover metadata and require file reselection", async ({
  page,
}) => {
  await prepare(page);
  await open(page);
  await page.getByLabel("添加附件", { exact: true }).setInputFiles({
    name: "未上传凭据.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("PRIVATE-FILE-BYTES-MUST-NOT-BE-STORED"),
  });
  await expect
    .poll(async () => (await snapshots(page))[0]?.pendingUploadReselection)
    .toBe(true);
  expect(JSON.stringify(await snapshots(page))).not.toContain(
    "PRIVATE-FILE-BYTES",
  );
  expect(JSON.stringify(await snapshots(page))).not.toContain("blob:");
  await page.reload();
  await page.getByRole("button", { name: "检查并恢复", exact: true }).click();
  await expect(
    page.getByLabel("需要重新选择文件", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("未上传凭据.txt", { exact: true })).toBeVisible();
});

test("blocked recovery storage keeps the form usable and its leave guard active", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("temple-inventory:recovery:"))
        throw new DOMException("blocked", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await prepare(page);
  await open(page);
  await page.getByLabel("来源", { exact: true }).fill("存储被拒绝时保留在表单");
  await expect(page.getByRole("alert")).toContainText("无法持久保留输入");
  await expect(page.getByLabel("来源", { exact: true })).toBeEditable();
  expect(await snapshots(page)).toEqual([]);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "继续编辑", exact: true })
    .click();
  await expect(page.getByLabel("来源", { exact: true })).toHaveValue(
    "存储被拒绝时保留在表单",
  );
});
