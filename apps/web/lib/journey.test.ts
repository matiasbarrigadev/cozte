import { describe, expect, it } from "vitest";
import { DEFAULT_JOURNEYS, moduleAccess, parseJourneyDefinition, stageViews, type JourneyFacts } from "./journey";

const none: JourneyFacts = { products: 0, productsWithRecipe: 0, productsWithPrice: 0, materialsUsed: 0, materialsUsedPriced: 0, recipesConfirmed: 0, suppliers: 0, purchases: 0, productionExpenses: 0, channels: 0, channelsWithDelivery: 0, deliveryZones: 0, sales: 0, deliveries: 0, customers: 0 };
const base = { level: "simple" as const, unlockAll: false, unlocked: new Set<string>(), withData: new Set<never>(), firstSale: false };

describe("discovery path stages", () => {
  it("starts on the first stage and moves on as the company's data completes each one", () => {
    expect(stageViews(DEFAULT_JOURNEYS.operating, none).map((stage) => stage.status)).toEqual(["current", "pending", "pending", "pending", "pending"]);
    const withRecipe = { ...none, products: 1, productsWithRecipe: 1, materialsUsed: 2, materialsUsedPriced: 1 };
    const stages = stageViews(DEFAULT_JOURNEYS.operating, withRecipe);
    expect(stages.map((stage) => stage.status)).toEqual(["done", "current", "pending", "pending", "pending"]);
    expect(stages[1].missing).toEqual(["Una receta que confirmaste como completa", "Todos los insumos de las recetas con precio"]);
    // Every supply priced is not enough: the person says the recipe is complete.
    expect(stageViews(DEFAULT_JOURNEYS.operating, { ...withRecipe, materialsUsedPriced: 2 })[1].missing).toEqual(["Una receta que confirmaste como completa"]);
    expect(stageViews(DEFAULT_JOURNEYS.operating, { ...withRecipe, materialsUsedPriced: 2, recipesConfirmed: 1 })[1].status).toBe("done");
    // A later stage done first does not hide an earlier one still missing.
    expect(stageViews(DEFAULT_JOURNEYS.operating, { ...none, productionExpenses: 2 }).map((stage) => stage.status)).toEqual(["current", "pending", "done", "pending", "pending"]);
  });
});

describe("which sections each person sees", () => {
  it("opens sections as stages complete for simple and medium readers", () => {
    const empty = moduleAccess(DEFAULT_JOURNEYS.operating, { ...base, mode: "operating", completed: new Set() });
    expect(empty.asistente).toEqual({ state: "open" });
    expect(empty.analisis).toEqual({ state: "open" });
    expect(empty.planilla).toEqual({ state: "locked", reason: "Se habilita al completar «Qué producís»", stageId: "producto" });
    expect(empty.resultado).toEqual({ state: "locked", reason: "Se habilita con tu primera venta" });
    const afterFirst = moduleAccess(DEFAULT_JOURNEYS.operating, { ...base, mode: "operating", completed: new Set(["producto"]) });
    expect(afterFirst.planilla.state).toBe("open");
    expect(afterFirst.gastos.state).toBe("locked");
    // Channels open with the stage before selling, so they can be set up while that stage is current.
    expect(afterFirst.canales).toEqual({ state: "locked", reason: "Se habilita al completar «Dónde producís»", stageId: "lugar" });
    expect(moduleAccess(DEFAULT_JOURNEYS.operating, { ...base, mode: "operating", completed: new Set(["producto", "insumos", "lugar"]) }).canales.state).toBe("open");
  });

  it("keeps the sections about real sales closed while a project does not sell", () => {
    const project = moduleAccess(DEFAULT_JOURNEYS.project, { ...base, mode: "project", completed: new Set(["producto", "insumos", "lugar", "venta", "entrega"]) });
    expect(project.ventas).toEqual({ state: "locked", reason: "Se habilita cuando empieces a vender" });
    expect(project.equilibrio.state).toBe("open");
    expect(moduleAccess(DEFAULT_JOURNEYS.project, { ...base, mode: "operating", completed: new Set() }).ventas.state).toBe("open");
  });

  it("shows everything to an advanced reader, saying what is missing, and never closes what was opened or holds data", () => {
    const advanced = moduleAccess(DEFAULT_JOURNEYS.project, { ...base, level: "advanced", mode: "project", completed: new Set() });
    expect(advanced.planilla).toEqual({ state: "open", badge: "Falta: Qué querés producir", stageId: "producto" });
    expect(advanced.ventas).toEqual({ state: "open", badge: "Cuando vendas" });
    const kept = moduleAccess(DEFAULT_JOURNEYS.operating, { ...base, mode: "operating", completed: new Set(), unlocked: new Set(["gastos"]), withData: new Set(["entregas"] as const) });
    expect(kept.gastos.state).toBe("open");
    expect(kept.entregas.state).toBe("open");
    expect(Object.values(moduleAccess(DEFAULT_JOURNEYS.operating, { ...base, mode: "operating", completed: new Set(), unlockAll: true })).every((access) => access.state === "open" && !access.badge)).toBe(true);
  });
});

describe("paths as data", () => {
  it("accepts a path with a stage added or removed, and falls back to the built-in one when a stored path is broken", () => {
    const custom = structuredClone(DEFAULT_JOURNEYS.project);
    custom.name = "Curso de emprendimiento";
    custom.stages.splice(4, 1);
    custom.stages.splice(1, 0, { id: "cliente", title: "Para quién es", why: "Saber a quién le vendés ordena el precio y el canal.", completeWhen: ["sale_price"], unlocks: [], prompt: "Pensemos para quién es mi producto.", interview: ["Quién compraría y por qué"] });
    const parsed = parseJourneyDefinition(JSON.stringify(custom), DEFAULT_JOURNEYS.project);
    expect(parsed.error).toBeNull();
    expect(parsed.definition.stages.map((stage) => stage.id)).toEqual(["producto", "cliente", "insumos", "lugar", "venta"]);
    // Without the delivery stage, nothing governs Entregas: it stays visible.
    expect(moduleAccess(parsed.definition, { ...base, mode: "project", completed: new Set() }).entregas.state).toBe("open");

    expect(parseJourneyDefinition("{not json", DEFAULT_JOURNEYS.operating)).toMatchObject({ definition: DEFAULT_JOURNEYS.operating, error: "No es un JSON válido" });
    const duplicated = { ...custom, stages: [custom.stages[0], custom.stages[0]] };
    expect(parseJourneyDefinition(JSON.stringify(duplicated), DEFAULT_JOURNEYS.project).error).toMatch(/id distinto/);
    const unknownRule = { ...custom, stages: [{ ...custom.stages[0], completeWhen: ["has_website"] }] };
    expect(parseJourneyDefinition(JSON.stringify(unknownRule), DEFAULT_JOURNEYS.project).definition).toBe(DEFAULT_JOURNEYS.project);
  });
});
