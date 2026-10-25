import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const icons = path.join(root, "frontend/public/pwa-icons");
const sourceRoot = path.join(root, "frontend/public/pwa-icons");
const environments = [
  { prefix: "sample-", label: "演示", color: "#8a4b08" },
  { prefix: "staging-", label: "预发布", color: "#593d8c" },
  { prefix: "development-", label: "开发", color: "#245b9e" },
];
const variants = [
  {
    source: "icon-192.png",
    target: "icon-192.png",
    size: 192,
    maskable: false,
  },
  {
    source: "icon-512.png",
    target: "icon-512.png",
    size: 512,
    maskable: false,
  },
  {
    source: "icon-512-maskable.png",
    target: "icon-512-maskable.png",
    size: 512,
    maskable: true,
  },
  {
    source: "apple-touch-icon-180.png",
    target: "apple-touch-icon-180.png",
    size: 180,
    maskable: false,
  },
  {
    source: "icon-192.png",
    target: "favicon-32.png",
    size: 32,
    maskable: false,
  },
];
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: ["--no-sandbox"],
});

try {
  await mkdir(icons, { recursive: true });
  for (const environment of environments) {
    for (const variant of variants) {
      const bytes = await readFile(path.join(sourceRoot, variant.source));
      const source = `data:image/png;base64,${bytes.toString("base64")}`;
      const page = await browser.newPage({
        viewport: { width: variant.size, height: variant.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}</style><canvas width="${variant.size}" height="${variant.size}"></canvas>`,
      );
      await page.evaluate(
        async ({ source, label, color, maskable }) => {
          const canvas = document.querySelector("canvas");
          const ctx = canvas.getContext("2d");
          const image = new Image();
          image.src = source;
          await image.decode();
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const safe = maskable ? canvas.height * 0.1 : 0;
          const bandHeight = canvas.height * (canvas.width <= 32 ? 0.4 : 0.22);
          const y = Math.min(
            canvas.height - safe - bandHeight,
            canvas.height * 0.73,
          );
          ctx.fillStyle = color;
          ctx.fillRect(safe, y, canvas.width - safe * 2, bandHeight);
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `700 ${Math.max(6, Math.round(canvas.width * (canvas.width <= 32 ? 0.2 : 0.105)))}px sans-serif`;
          ctx.fillText(
            label,
            canvas.width / 2,
            y + bandHeight / 2,
            canvas.width - safe * 2 - 6,
          );
        },
        {
          source,
          label: environment.label,
          color: environment.color,
          maskable: variant.maskable,
        },
      );
      await page.screenshot({
        path: path.join(icons, `${environment.prefix}${variant.target}`),
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
