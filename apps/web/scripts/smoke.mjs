import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const systemChrome = process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : null;
const executablePath = process.env.CHROME_PATH ?? (systemChrome && existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.BASE_URL ?? "http://localhost:3000/demo", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Costos de tus productos" }).waitFor();
  assert.equal(await page.getByRole("row").count(), 4);
  await page.screenshot({ path: "../../tmp/cozte-dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Planilla de costos" }).click();
  await page.getByRole("heading", { name: "Insumos y gastos" }).waitFor();
  await page.getByRole("spinbutton", { name: "Nuevo precio de Papel interior" }).fill("10000");
  await page.getByRole("button", { name: "Revisar impacto" }).click();
  await page.getByRole("heading", { name: "Antes de confirmar" }).waitFor();
  assert.equal(await page.getByText("$3.110").count() > 0, true);
  await page.screenshot({ path: "../../tmp/cozte-review.png", fullPage: true });
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Abrir Cuaderno A5 · tapa dura" }).click();
  await page.getByRole("heading", { name: "Cuaderno A5 · tapa dura" }).waitFor();
  await page.screenshot({ path: "../../tmp/cozte-product.png", fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(process.env.BASE_URL ?? "http://localhost:3000/demo", { waitUntil: "networkidle" });
  await mobile.getByRole("heading", { name: "Costos de tus productos" }).waitFor();
  await mobile.screenshot({ path: "../../tmp/cozte-mobile.png", fullPage: true });
  const cron = await mobile.request.get((process.env.BASE_URL ?? "http://localhost:3000") + "/api/cron/freshness");
  assert.equal(cron.status(), 401, "cron must reject requests without a secret");
  await mobile.close();
  console.log("Demo smoke test passed");
} finally {
  await browser.close();
}
