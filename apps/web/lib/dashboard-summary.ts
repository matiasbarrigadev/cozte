import { calculateCosts, productionCostSources, type DomainState, type ProductCost } from "./domain";
import { costGaps } from "./cozte-cost-view";

export type DashboardLesson = { id: "driver" | "volume" | "contribution" | "price"; title: string; text: string };
export type CostComposition = { productId: string; name: string; unitCost: number; materials: number; labor: number; shared: number };

export type DashboardSummary = {
  products: number;
  /** Products whose unit cost the engine can show (complete or estimated). */
  calculated: number;
  estimated: number;
  /** Lot cost × lots per month of every product; null until all of them have a cost and a monthly volume. */
  monthlyProductionCost: number | null;
  gaps: string[];
  composition: CostComposition[];
  lessons: DashboardLesson[];
};

const percent = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
const units = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);

/**
 * What the dashboard shows: how far the costing is, what is missing, what each unit is made of and a few
 * lessons written with the company's own numbers. Everything comes from the engine; nothing is estimated here.
 */
export function dashboardSummary(state: DomainState, costs: ProductCost[], money: (value: number) => string): DashboardSummary {
  const productName = (id: string) => state.products.find((product) => product.id === id)?.name ?? "";
  const calculated = costs.filter((cost) => cost.unitMinor !== null && cost.perUnit !== null);
  const allWithVolume = state.products.length > 0 && state.products.every((product) => product.batchesPerMonthMilli != null);
  const monthlyProductionCost = allWithVolume && calculated.length === costs.length
    ? Math.round(costs.reduce((sum, cost) => sum + cost.totalLotMinor! * cost.monthly.batchesMilli / 1000, 0))
    : null;
  const composition = calculated.map((cost) => ({
    productId: cost.productId, name: productName(cost.productId), unitCost: cost.unitMinor!,
    materials: cost.perUnit!.materialMinor, labor: cost.perUnit!.laborMinor, shared: cost.perUnit!.sharedMinor,
  }));

  const lessons: DashboardLesson[] = [];
  // The product made in the largest quantity is the one whose numbers matter most.
  const main = [...calculated].sort((a, b) => b.monthly.units - a.monthly.units)[0];
  if (main) {
    const product = state.products.find((item) => item.id === main.productId)!;
    const lotUnits = Math.max(product.lotUnits, 1);
    const parts: { label: string; perUnit: number }[] = [
      ...main.lines.filter((line) => line.kind === "material").map((line) => ({ label: line.label, perUnit: line.amountMinor / lotUnits })),
      ...(main.perUnit!.laborMinor > 0 ? [{ label: "la mano de obra directa", perUnit: main.perUnit!.laborMinor }] : []),
      ...Object.entries(main.monthly.sharedByExpense).map(([id, amount]) => ({
        label: `el gasto de ${productionCostSources(state).find((expense) => expense.id === id)?.name ?? "un gasto compartido"}`,
        perUnit: amount / Math.max(main.monthly.units, 1),
      })),
    ].sort((a, b) => b.perUnit - a.perUnit);
    const top = parts[0];
    if (top && main.unitMinor! > 0) {
      lessons.push({
        id: "driver", title: "Qué pesa más en tu costo",
        text: `En ${product.name}, ${top.label} es el ${percent(top.perUnit / main.unitMinor! * 100)} % de lo que cuesta cada unidad (${money(top.perUnit)} de ${money(main.unitMinor!)}). Es lo primero que conviene revisar para bajar el costo: el precio, el proveedor o cuánto se usa.`,
      });
    }
    if (allWithVolume && main.perUnit!.sharedMinor > 0) {
      const busier = { ...state, products: state.products.map((item) => ({ ...item, batchesPerMonthMilli: Math.round(item.batchesPerMonthMilli! * 1.25) })) };
      const after = calculateCosts(busier).find((cost) => cost.productId === main.productId)?.unitMinor;
      if (after != null && after < main.unitMinor!) {
        lessons.push({
          id: "volume", title: "Gastos fijos y volumen",
          text: `Los gastos del mes (alquiler, luz, sueldos…) se reparten entre todo lo que produces. Si produjeras un 25 % más con los mismos gastos, cada ${product.name} costaría ${money(after)} en vez de ${money(main.unitMinor!)}. Por eso aprovechar mejor la capacidad baja el costo por unidad.`,
        });
      }
    }
  }

  const priced = calculated.filter((cost) => cost.economics);
  const withPrice = priced.find((cost) => cost.productId === main?.productId) ?? priced[0];
  if (withPrice) {
    const product = state.products.find((item) => item.id === withPrice.productId)!;
    const economics = withPrice.economics!;
    lessons.push(economics.contributionUnitMinor > 0 ? {
      id: "contribution", title: "Margen de contribución",
      text: `Cada ${product.name} que vendes a ${money(product.salePriceMinor)} deja ${money(economics.contributionUnitMinor)} después de pagar sus insumos, su mano de obra directa y sus gastos de venta.${economics.breakEvenUnitsPerMonth !== null && withPrice.monthly.sharedMinor > 0 ? ` Con ${units(economics.breakEvenUnitsPerMonth)} unidades al mes cubre los ${money(withPrice.monthly.sharedMinor)} de gastos del mes que tiene asignados; desde ahí, cada venta es ganancia.` : ""}`,
    } : {
      id: "contribution", title: "Margen de contribución",
      text: `${product.name} se vende a ${money(product.salePriceMinor)}, pero solo sus insumos, mano de obra y gastos de venta suman ${money(economics.variableUnitMinor)}: cada unidad vendida agranda la pérdida. Conviene revisar el precio o la receta antes de vender más.`,
    });
  } else if (calculated.length) {
    lessons.push({
      id: "price", title: "Precio y margen",
      text: "Todavía no hay precios de venta cargados. Con el precio en la ficha de cada producto verás cuánto te deja cada unidad y cuántas necesitas vender al mes para cubrir los gastos.",
    });
  }

  return {
    products: state.products.length,
    calculated: calculated.length,
    estimated: calculated.filter((cost) => cost.quality === "estimated").length,
    monthlyProductionCost,
    gaps: costGaps(state, costs),
    composition,
    lessons,
  };
}
