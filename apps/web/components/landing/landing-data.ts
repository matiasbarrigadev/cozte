import { buildBusinessView, priceSale } from "@/lib/business";
import { analysisInsights, monthsBack, summarizeMonth } from "@/lib/business-analytics";
import { calculateCosts } from "@/lib/domain";
import { DEMO_MONTH, DEMO_TODAY, demoBusinessRecords, demoDeliveries, demoHistorySales, demoState } from "@/lib/demo";
import { demoCustomerList, demoSupplierList } from "@/lib/demo-store";
import { suggestRouteOrder } from "@/lib/delivery-routes";

/**
 * What the landing mockups show, computed by the same engine as the app on the demo business (Taller Norte): nothing
 * is typed by hand, so the numbers add up like they do in the workspace.
 */

const money = (value: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(value));

const records = demoBusinessRecords();
const withHistory = { ...records, sales: [...demoHistorySales(), ...records.sales] };

export const landingMonths = monthsBack(DEMO_MONTH, 6).map((month) => summarizeMonth(buildBusinessView(demoState, withHistory, month), month, DEMO_TODAY));
export const landingInsights = analysisInsights(landingMonths, landingMonths.length - 1, money).slice(0, 4);

const named = (costs: ReturnType<typeof calculateCosts>) => demoState.products.map((product) => {
  const cost = costs.find((item) => item.productId === product.id)!;
  return { id: product.id, name: product.name, price: product.salePriceMinor ?? 0, unit: cost.unitMinor ?? 0, parts: cost.perUnit ?? { materialMinor: 0, laborMinor: 0, sharedMinor: 0 } };
});

/** Unit costs today, with paper at $10.000 (the what-if) and with August's paper price (before the last invoice). */
export const landingCosts = named(calculateCosts(demoState));
export const landingCostsPaperUp = named(calculateCosts(demoState, { papel: 10000 }));
export const landingCostsAugust = named(calculateCosts(demoState, { papel: 8800 }));

export const landingCustomers = demoCustomerList().customers.filter((row) => row.stats.revenue > 0).sort((a, b) => b.stats.revenue - a.stats.revenue).slice(0, 6);
export const landingPrices = demoSupplierList().suppliers.flatMap((row) => row.prices.map((price) => ({ supplier: row.name, ...price }))).filter((price) => price.points.length > 1).sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)).slice(0, 4);

/** Today's motorbike route around Santiago, in suggested driving order. */
export const landingRoute = suggestRouteOrder(demoDeliveries(DEMO_TODAY).filter((item) => item.scheduledOn === DEMO_TODAY && item.status === "pending" && item.zoneId === "z-santiago"));


/** The sale Cozte records in the hero: 40 soft-cover notebooks for a bookshop, wholesale. */
const wholesale = records.channels.find((channel) => channel.id === "librerias")!;
const heroPriced = priceSale(demoState, calculateCosts(demoState), wholesale, [{ productId: "blanda", quantity: 40 }]);
export const landingHeroSale = {
  total: heroPriced.totalMinor,
  left: heroPriced.totalMinor - (heroPriced.variableCostMinor ?? 0) - heroPriced.sellingCostMinor - heroPriced.deliveryCostMinor,
};
