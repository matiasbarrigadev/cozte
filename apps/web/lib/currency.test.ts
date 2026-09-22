import { describe, expect, it } from "vitest";
import { convertNativeMilli, makeQuote, toNativeMilli } from "./currency";

describe("official exchange conversion", () => {
  const rates = { USD: 1514, CLP: 1.6, EUR: 1735.95 };
  it("converts USD to CLP through the same BCRA publication", () => {
    const quote = makeQuote("USD", "CLP", rates, "2026-09-21")!;
    expect(quote.ratePpm).toBe(946_250_000);
    expect(convertNativeMilli(toNativeMilli(12.5), quote)).toBe(11828);
  });
  it("converts USD to ARS and preserves fractional source amounts", () => {
    const quote = makeQuote("USD", "ARS", rates, "2026-09-21")!;
    expect(convertNativeMilli(toNativeMilli(19.95), quote)).toBe(30204);
  });
  it("requires an available official quote", () => {
    expect(makeQuote("BRL", "CLP", rates, "2026-09-21")).toBeNull();
  });
  it("converts from an FXRatesAPI USD publication without treating it as BCRA", () => {
    const quote = makeQuote("USD", "CLP", { CLP: 947.5, ARS: 1514 }, "2026-09-22T03:59:00.000Z", "FXRatesAPI")!;
    expect(quote.ratePpm).toBe(947_500_000);
    expect(quote.source).toBe("FXRatesAPI");
    expect(convertNativeMilli(toNativeMilli(12.5), quote)).toBe(11844);
  });
  it("converts a LATAM cross-rate from one USD-base publication", () => {
    const quote = makeQuote("COP", "MXN", { COP: 4100, MXN: 18 }, "2026-09-22T03:59:00.000Z", "FXRatesAPI")!;
    expect(convertNativeMilli(toNativeMilli(4100), quote)).toBe(18);
  });
});
