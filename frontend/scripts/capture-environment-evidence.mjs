import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("..");
const output = path.join(root, "notes/evidence/2026-10-25-ui-polish/after-env");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: [
    "--no-sandbox",
    "--host-resolver-rules=MAP development.localhost 127.0.0.1",
  ],
});
const environments = [
  {
    key: "production",
    environment: "production",
    label: "",
    title: "物资管理",
    short_name: "物资管理",
    theme_color: "#28684e",
  },
  {
    key: "sample",
    environment: "sample",
    label: "演示",
    title: "物资管理·演示",
    short_name: "物资·演示",
    theme_color: "#8a4b08",
  },
];

try {
  const contact = await browser.newPage({
    viewport: { width: 1200, height: 780 },
    deviceScaleFactor: 2,
  });
  const variants = [
    ["sample", "sample-icon-192.png", "192"],
    ["sample", "sample-icon-512.png", "512"],
    ["sample", "sample-icon-512-maskable.png", "maskable"],
    ["sample", "sample-apple-touch-icon-180.png", "apple 180"],
    ["sample", "sample-favicon-32.png", "favicon 32"],
    ["staging", "staging-icon-192.png", "192"],
    ["staging", "staging-icon-512.png", "512"],
    ["staging", "staging-icon-512-maskable.png", "maskable"],
    ["staging", "staging-apple-touch-icon-180.png", "apple 180"],
    ["staging", "staging-favicon-32.png", "favicon 32"],
    ["development", "development-icon-192.png", "192"],
    ["development", "development-icon-512.png", "512"],
    ["development", "development-icon-512-maskable.png", "maskable"],
    ["development", "development-apple-touch-icon-180.png", "apple 180"],
    ["development", "development-favicon-32.png", "favicon 32"],
  ];
  const imageData = await Promise.all(
    variants.map(async ([environment, filename, size]) => ({
      environment,
      filename,
      size,
      data: (
        await readFile(path.join(root, "frontend/public/pwa-icons", filename))
      ).toString("base64"),
    })),
  );
  await contact.setContent(
    `<style>body{margin:0;background:#f4f6f3;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:20px;text-align:center}img{width:130px;height:130px;object-fit:contain}small{display:block;margin-top:8px}</style><main>${imageData.map((item) => `<div><img src="data:image/png;base64,${item.data}"><small>${item.environment} · ${item.size}</small></div>`).join("")}</main>`,
  );
  await contact.screenshot({
    path: path.join(output, "environment-icons.png"),
    fullPage: true,
  });
  await contact.close();

  for (const environment of environments) {
    for (const surface of [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const { name, ...viewport } = surface;
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      await page.addInitScript((descriptor) => {
        window.environment = descriptor;
      }, environment);
      const response = await page.goto(
        "http://development.localhost:8091/inventory/",
        { waitUntil: "domcontentloaded" },
      );
      if (!response?.ok())
        throw new Error(
          `Vite returned ${response?.status()} for ${environment.key}/${viewport.name}`,
        );
      const rawHtml = await response.text();
      if (rawHtml.includes("{{"))
        throw new Error(
          "Vite dev HTML contains an unrendered Jinja expression",
        );
      await page.evaluate(async () => {
        await fetch("/api/method/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ usr: "Administrator", pwd: "admin" }),
        });
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
      const header =
        name === "desktop"
          ? ".sample-sidebar .sample-brand"
          : ".mobile-app-topbar";
      if (!(await page.locator(header).count()))
        throw new Error(
          `App header did not mount for ${environment.key}/${name}`,
        );
      if ((await page.title()) !== environment.title)
        throw new Error(
          `Unexpected document title for ${environment.key}/${name}: ${await page.title()}`,
        );
      await page.screenshot({
        path: path.join(output, `${environment.key}-${name}.png`),
        fullPage: false,
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
