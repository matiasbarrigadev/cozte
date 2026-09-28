import { describe, expect, it } from "vitest";
import { buildBusinessView } from "./business";
import { calculateCosts } from "./domain";
import { DEMO_MONTH, DEMO_TODAY, demoBusinessRecords, demoDeliveries, demoState } from "./demo";
import { DECK_TEMPLATE_KEYS, applyOperations, buildChart, buildKpi, formatMoney, newDeck, templateOutline, templateSlides, unbackedAmounts, type DeckSources } from "./decks";

const sources: DeckSources = {
  state: demoState, costs: calculateCosts(demoState), analysis: null, now: "2026-09-25T12:00:00Z",
  views: { [DEMO_MONTH]: buildBusinessView(demoState, demoBusinessRecords(), DEMO_MONTH) },
};

describe("presentations", () => {
  it("builds every template with engine figures and a closing summary", () => {
    for (const template of DECK_TEMPLATE_KEYS) {
      const deck = newDeck({ month: DEMO_MONTH, slides: templateSlides(template, DEMO_MONTH, sources) }, sources, template);
      expect(deck.slides[0].layout).toBe("cover");
      expect(deck.slides.at(-1)?.bullets?.length ?? 0).toBeGreaterThan(0);
      expect(templateOutline(template)).toMatch(/^portada, /);
    }
    const sales = newDeck({ month: DEMO_MONTH, slides: templateSlides("ventas", DEMO_MONTH, sources) }, sources);
    const revenue = sales.slides[1].kpis?.find((kpi) => kpi.metric === "revenue")?.value;
    expect(revenue).toBe(sources.views[DEMO_MONTH].result.revenue);
    expect(sales.slides[2].chart?.data.type).toBe("bars");
    expect(sales.slides[2].chart?.insight).toMatch(/canal/);
  });

  it("reads every slide number of one call against the deck as it was before the call", () => {
    const deck = newDeck({ month: DEMO_MONTH, slides: [
      { layout: "cover", title: "Informe" }, { title: "Ventas", chart: "sales-by-channel" }, { title: "Productos", chart: "sales-by-product" },
      { title: "Días", chart: "sales-by-day" }, { layout: "closing", title: "Cierre" },
    ] }, sources);
    const meta = { title: "Informe", theme: "cozte" as const };
    const result = applyOperations(deck, meta, [
      { action: "remove", slide: 2 },
      { action: "remove", slide: 4 },
      { action: "add", slide: { layout: "bullets", title: "Ideas", bullets: ["Uno"] }, position: 5 },
      { action: "update", slide: 3, set: { chart: "month-result", text: "Así cerró el mes" } },
      { action: "settings", theme: "noche" },
    ], sources);
    expect(result.deck.slides.map((slide) => slide.title)).toEqual(["Informe", "Productos", "Ideas", "Cierre"]);
    expect(result.deck.slides[1].chart?.kind).toBe("month-result");
    expect(result.meta.theme).toBe("noche");
    const moved = applyOperations(deck, meta, [{ action: "move", slide: 2, to: 4 }], sources).deck.slides.map((slide) => slide.title);
    expect(moved).toEqual(["Informe", "Productos", "Días", "Ventas", "Cierre"]);
    const up = applyOperations(deck, meta, [{ action: "move", slide: 4, to: 2 }], sources).deck.slides.map((slide) => slide.title);
    expect(up).toEqual(["Informe", "Días", "Ventas", "Productos", "Cierre"]);
    // Without a position a new slide goes last, but before the closing; an explicit position past the end is respected.
    const added = applyOperations(deck, meta, [{ action: "add", slide: { title: "Equilibrio", chart: "break-even" } }], sources).deck.slides.map((slide) => slide.title);
    expect(added).toEqual(["Informe", "Ventas", "Productos", "Días", "Equilibrio", "Cierre"]);
    const last = applyOperations(deck, meta, [{ action: "add", slide: { layout: "bullets", title: "Anexo", bullets: ["Uno"] }, position: 6 }], sources).deck.slides.map((slide) => slide.title);
    expect(last.at(-1)).toBe("Anexo");
    expect(() => applyOperations(deck, meta, [{ action: "remove", slide: 9 }], sources)).toThrow(/No existe/);
    expect(() => applyOperations(deck, meta, [{ action: "remove", slide: 2 }, { action: "update", slide: 2, set: { title: "x" } }], sources)).toThrow(/ya se quitó/);
  });

  it("flags amounts in texts that no chart or figure shows", () => {
    const deck = newDeck({ month: DEMO_MONTH, slides: [
      { title: "Ventas", chart: "sales-by-channel", text: `Vendimos ${formatMoney(sources.views[DEMO_MONTH].result.revenue, demoState.organization.currency)} en total y la feria aportó $999.999.` },
    ] }, sources);
    expect(unbackedAmounts(deck)).toEqual(["$999.999"]);
  });

  it("shows the state of deliveries, the most urgent first, and counts what is late", () => {
    const withDeliveries = { ...sources, deliveries: demoDeliveries(DEMO_TODAY), today: DEMO_TODAY };
    const upcoming = buildChart("upcoming-deliveries", null, DEMO_MONTH, withDeliveries);
    expect(upcoming.data.type === "table" && upcoming.data.rows.map((row) => row[0])).toEqual(["Atrasada 2 d", "Hoy", "Hoy", "Hoy", "Hoy", "29/09"]);
    expect(upcoming.insight).toMatch(/1 atrasada/);
    const status = buildChart("delivery-status", null, DEMO_MONTH, withDeliveries);
    expect(status.data.type === "bars" && status.data.rows.map((row) => `${row.label}:${row.value}`)).toEqual(["Pendiente:4", "En camino:1", "Entregada:2", "No se pudo entregar:1"]);
    expect(buildKpi("pending-deliveries", null, DEMO_MONTH, withDeliveries).value).toBe(6);
    expect(buildKpi("late-deliveries", null, DEMO_MONTH, withDeliveries).value).toBe(1);
    expect(buildKpi("deliveries", null, DEMO_MONTH, withDeliveries).value).toBe(2);
    expect(buildChart("upcoming-deliveries", null, DEMO_MONTH, sources).data.type).toBe("empty");
  });
});
