import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractMarketPrice, numbersIn } from "./market-prices";
import { priceExcerpt } from "./web-search";

const results = [
  { title: "Nafta súper en Córdoba", url: "https://precios.example/nafta", snippet: "Precio por litro de nafta súper en Córdoba", excerpt: "Nafta Súper: $1.389,50 por litro · Premium: $1.702" },
  { title: "Otra página", url: "https://otra.example", snippet: "Sin precios" },
];
const input = { item: "Nafta súper", unit: "litro", currency: "ARS" as const, country: "AR", results, today: "2026-10-01" };

describe("prices read from the web", () => {
  it("keeps only the lines of a page that carry prices, without links or images", () => {
    const text = priceExcerpt("# Combustibles\n\n![logo](x.png)\nNuestra historia\nNafta Súper [ver](https://a) $1.389,50 por litro\nGasoil $1.250\n");
    expect(text).toBe("Nafta Súper ver $1.389,50 por litro · Gasoil $1.250");
  });

  it("reads numbers written in either decimal convention", () => {
    expect(numbersIn("$1.389,50 y 1,389.50 y 25")).toEqual(expect.arrayContaining([1389.5, 25]));
  });

  it("accepts a price only when that number is written on the page it cites, in the asked currency", async () => {
    const answer = (value: object) => async () => JSON.stringify(value);
    expect(await extractMarketPrice(input, answer({ found: true, price: 1389.5, currency: "ARS", sourceUrl: "https://precios.example/nafta", sourceTitle: "x", observedOn: "2026-09-30" })))
      .toEqual({ price: 1389.5, currency: "ARS", sourceUrl: "https://precios.example/nafta", sourceTitle: "Nafta súper en Córdoba", observedOn: "2026-09-30" });
    // A number the page does not show, a page not in the results, another currency, a future date.
    expect(await extractMarketPrice(input, answer({ found: true, price: 1400, currency: "ARS", sourceUrl: "https://precios.example/nafta" }))).toBeNull();
    expect(await extractMarketPrice(input, answer({ found: true, price: 1389.5, currency: "ARS", sourceUrl: "https://inventada.example" }))).toBeNull();
    expect(await extractMarketPrice(input, answer({ found: true, price: 1389.5, currency: "USD", sourceUrl: "https://precios.example/nafta" }))).toBeNull();
    expect((await extractMarketPrice(input, answer({ found: true, price: 1389.5, currency: "ARS", sourceUrl: "https://precios.example/nafta", observedOn: "2027-01-01" })))?.observedOn).toBe("2026-10-01");
    expect(await extractMarketPrice(input, answer({ found: false }))).toBeNull();
    expect(await extractMarketPrice(input, async () => "no es json")).toBeNull();
  });
});
