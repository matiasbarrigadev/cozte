import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const systemChrome = process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : null;
const executablePath = process.env.CHROME_PATH ?? (systemChrome && existsSync(systemChrome) ? systemChrome : undefined);
const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/demo`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Costos de tus productos" }).waitFor();
  assert.equal(await page.getByRole("row").count(), 4);
  await page.screenshot({ path: "../../tmp/cozte-dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Planilla de costos" }).click();
  await page.getByRole("heading", { name: "Tu hoja de costos" }).waitFor();
  await page.getByRole("button", { name: "Papel", exact: true }).click();
  assert.equal(await page.getByRole("row").count(), 2, "category filter should keep only the matching material");
  await page.getByRole("button", { name: "Todas", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Precio de Papel interior" }).fill("10000");
  await page.getByRole("spinbutton", { name: "Precio de Papel interior" }).press("Tab");
  await page.getByText("Puede cambiar el costeo de 3 productos").waitFor();
  await page.screenshot({ path: "../../tmp/cozte-sheet.png", fullPage: true });
  await page.getByRole("button", { name: "Revisar impacto" }).click();
  await page.getByRole("heading", { name: "Antes de confirmar" }).waitFor();
  assert.equal(await page.getByText("$3.110").count() > 0, true);
  await page.screenshot({ path: "../../tmp/cozte-review.png", fullPage: true });
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Abrir Cuaderno A5 · tapa dura" }).click();
  await page.getByRole("heading", { name: "Cuaderno A5 · tapa dura" }).waitFor();
  await page.screenshot({ path: "../../tmp/cozte-product.png", fullPage: true });
  await page.getByRole("button", { name: "Comprobantes" }).click();
  await page.getByRole("heading", { name: "Comprobantes" }).waitFor();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(`${baseUrl}/demo`, { waitUntil: "networkidle" });
  await mobile.getByRole("heading", { name: "Costos de tus productos" }).waitFor();
  await mobile.screenshot({ path: "../../tmp/cozte-mobile.png", fullPage: true });
  await mobile.getByRole("button", { name: "Toggle Sidebar" }).click();
  await mobile.getByRole("button", { name: "Planilla de costos" }).click();
  await mobile.getByRole("heading", { name: "Tu hoja de costos" }).waitFor();
  await mobile.waitForTimeout(400);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile page should not overflow horizontally");
  await mobile.screenshot({ path: "../../tmp/cozte-sheet-mobile.png", fullPage: true });
  const cron = await mobile.request.get(`${baseUrl}/api/cron/freshness`);
  assert.equal(cron.status(), 401, "cron must reject requests without a secret");
  await mobile.close();
  console.log("Demo smoke test passed");
} finally {
  await browser.close();
}
