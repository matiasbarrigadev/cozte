import assert from "node:assert/strict";
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}/demo`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Costos de producción" }).click();
  await page.getByRole("heading", { name: "Costos de producción" }).waitFor();
  await page.getByRole("button", { name: "Tablero" }).click();
  await page.getByRole("heading", { name: "Papel", exact: true }).waitFor();
  await page.screenshot({ path: join(tmpdir(), "cozte-cost-board.png"), fullPage: true });
  await page.getByRole("button", { name: "Lista" }).click();
  await page.getByRole("button", { name: "Tabla" }).click();
  assert.equal(await page.getByRole("row").count() > 5, true);
  await page.getByLabel("Período de Electricidad").fill("2026-10");
  await page.getByRole("heading", { name: "Este cambio afecta otros productos" }).waitFor();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.screenshot({ path: join(tmpdir(), "cozte-cost-table.png"), fullPage: true });
  await page.getByRole("button", { name: /Editar consumo/ }).first().click();
  await page.getByRole("heading", { name: "Consumo de Papel interior" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Categorías" }).click();
  await page.getByRole("heading", { name: "Categorías de la empresa" }).waitFor();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}/demo`, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "Toggle Sidebar" }).click();
  await mobile.getByRole("button", { name: "Costos de producción" }).click();
  await mobile.getByRole("heading", { name: "Costos de producción" }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "cost sheet should fit a mobile viewport");
  await mobile.getByRole("button", { name: "Tablero" }).click();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "board should fit a mobile viewport");
  console.log("Cost sheet smoke passed");
} finally {
  await browser.close();
}
