import { locationTimeZone } from "./locations";
import { calculateCosts, expensesInForce, investmentMonthlyShare, type CostArea, type DomainState, type Product, type ProductCost } from "./domain";
import { roundMoney } from "./money";

/** The organization's currency, when the caller has it: amounts follow its money precision (cents or whole units). */
type WithCurrency = { organization?: { currency: string } };

/**
 * Beyond the cost of making a product: what it costs to sell and deliver it, the company's own structure
 * (administration, sales, delivery), day-to-day purchases and the month's result. Pure functions: the server,
 * the demo and the tests share them.
 */

export type SalesChannel = {
  id: string;
  name: string;
  /** How orders reach the customer, in the person's words (pickup, own delivery, courier…). */
  deliveryMethod: string;
  /** Share of the price the channel keeps (commission, card, platform), in hundredths of a percent. */
  commissionBps: number;
  feePerOrderMinor: number;
  deliveryCostPerOrderMinor: number;
  unitsPerOrderMilli: number;
  /** Channel price against the list price (−2500 = 25 % less), in hundredths of a percent. */
  priceAdjustmentBps: number;
};

export type PurchaseKind = "material" | "expense" | "fixed_payment" | "investment";

export type Purchase = {
  id: string;
  purchasedOn: string;
  description: string;
  supplier: string;
  /** The supplier record it belongs to, found or created by name. */
  supplierId?: string | null;
  amountMinor: number;
  kind: PurchaseKind;
  area: CostArea;
  materialName?: string | null;
  quantityMilli?: number | null;
  expenseId?: string | null;
  expenseName?: string | null;
  usefulLifeMonths?: number | null;
  /** Workshop investments only: whether the person chose to spread it into each unit's cost. */
  includeInUnitCost?: boolean;
  documentId?: string | null;
  source: "user" | "cozte";
};

export type SaleItem = {
  productId: string;
  productName: string;
  quantityMilli: number;
  unitPriceMinor: number;
  /** Materials plus direct labor per unit when the sale was recorded. */
  unitVariableCostMinor: number | null;
  /** Full cost of making one unit, with the workshop's shared expenses. */
  unitCostMinor: number | null;
};

export type Sale = {
  id: string;
  soldOn: string;
  channelId: string | null;
  channelName: string;
  customer: string;
  note: string;
  totalMinor: number;
  sellingCostMinor: number;
  deliveryCostMinor: number;
  variableCostMinor: number | null;
  productionCostMinor: number | null;
  documentId?: string | null;
  source: "user" | "cozte";
  items: SaleItem[];
  /** The sale's delivery, when it has to reach the customer. */
  delivery?: SaleDelivery | null;
  /** The customer's record, when the sale has one. */
  customerId?: string | null;
};

export type DeliveryStatus = "pending" | "on_the_way" | "delivered" | "failed" | "cancelled";
export const DELIVERY_STATUSES: DeliveryStatus[] = ["pending", "on_the_way", "delivered", "failed", "cancelled"];
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = { pending: "Pendiente", on_the_way: "En camino", delivered: "Entregada", failed: "No se pudo entregar", cancelled: "Cancelada" };
export const DELIVERY_STATUS_HINTS: Record<DeliveryStatus, string> = {
  pending: "Todavía no salió",
  on_the_way: "Ya salió hacia el cliente",
  delivered: "El cliente la recibió",
  failed: "Hubo un problema: hay que reprogramarla",
  cancelled: "No se va a entregar",
};
export const isOpenDelivery = (status: DeliveryStatus) => status === "pending" || status === "on_the_way" || status === "failed";

export type SaleDelivery = { id: string; status: DeliveryStatus; scheduledOn: string; deliveredOn?: string | null; zoneId?: string | null; zoneName?: string; carrier?: string };

export type Delivery = {
  id: string;
  saleId: string;
  scheduledOn: string;
  timeWindow: string;
  status: DeliveryStatus;
  method: string;
  carrier: string;
  recipient: string;
  address: string;
  contact: string;
  tracking: string;
  note: string;
  deliveredOn: string | null;
  /** The delivery zone it goes to, picked from the address or by hand. */
  zoneId: string | null;
  zoneName: string;
  /** Its place in its day's route; null until someone or Cozte arranges it. */
  routePosition: number | null;
  source: "user" | "cozte";
  /** What delivering costs, kept on the sale so the month's result reads it. */
  costMinor: number;
  sale: { soldOn: string; channelId: string | null; channelName: string; customer: string; totalMinor: number; items: string };
};

/** Where each currency's businesses usually are, for the calendar day on the server. */
const CURRENCY_ZONES: Record<string, string> = {
  ARS: "America/Argentina/Buenos_Aires", CLP: "America/Santiago", MXN: "America/Mexico_City", COP: "America/Bogota", PEN: "America/Lima",
  UYU: "America/Montevideo", BOB: "America/La_Paz", PYG: "America/Asuncion", BRL: "America/Sao_Paulo", USD: "America/New_York", EUR: "Europe/Madrid",
};

/** Where a business is, as far as the calendar goes: its location when known, or just its currency. */
export type BusinessPlace = string | { currency?: string | null; country?: string | null; timeZone?: string | null } | null | undefined;

/**
 * Today's date (AAAA-MM-DD) where the business is, not in UTC: at 22:00 in Buenos Aires it is still today there.
 * Without a place it uses Buenos Aires, the timezone of most of Cozte's businesses.
 */
export function businessToday(place?: BusinessPlace, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: businessTimeZone(place), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The timezone where the business is: the one of its location (chosen, or its country's usual one); without a
 * location, the one its currency suggests; Buenos Aires by default. A string is a currency code or an IANA zone.
 */
export function businessTimeZone(place?: BusinessPlace): string {
  if (typeof place === "string") return place.includes("/") ? place : CURRENCY_ZONES[place] ?? "America/Argentina/Buenos_Aires";
  return (place && locationTimeZone(place)) || (place?.currency && CURRENCY_ZONES[place.currency]) || "America/Argentina/Buenos_Aires";
}

/** "sábado 27 de septiembre de 2026, 10:32" where the business is. */
export function businessNowLabel(place?: BusinessPlace, now = new Date()): string {
  const zone = businessTimeZone(place);
  const date = new Intl.DateTimeFormat("es-AR", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("es-AR", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return `${date}, ${time}`;
}

/** Whole days from today to a date (positive: ahead, negative: past). */
export function daysFrom(date: string, today: string): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/** Closest to today first; between one day ahead and one day behind, the one ahead comes first. */
export function byProximity<T>(items: T[], dateOf: (item: T) => string, today: string): T[] {
  return [...items].sort((a, b) => {
    const da = daysFrom(dateOf(a), today);
    const db = daysFrom(dateOf(b), today);
    return Math.abs(da) - Math.abs(db) || db - da;
  });
}

/** Most recent first. */
export function byRecency<T>(items: T[], dateOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
}

/** Pickup and in-person sales do not need a delivery; anything with a delivery cost or method does. */
export function needsDelivery(channel: Pick<SalesChannel, "deliveryMethod" | "deliveryCostPerOrderMinor">, deliveryCost?: number): boolean {
  if ((deliveryCost ?? channel.deliveryCostPerOrderMinor) > 0) return true;
  const method = channel.deliveryMethod.trim().toLowerCase();
  return Boolean(method) && !/retir|en mano|local|presencial|mostrador|pickup/.test(method);
}

/** A new delivery's status: one scheduled before today already happened; otherwise it is pending. */
export const initialDeliveryStatus = (scheduledOn: string, today: string): DeliveryStatus => scheduledOn < today ? "delivered" : "pending";

export type DeliverySummary = { today: number; next7: number; overdue: number; onTheWay: number; delivered: number; failed: number; cost: number; averageCost: number | null };

/** The logistics at a glance: what is due today and this week, what is late, and what delivering cost in the month. */
export function deliverySummary(deliveries: Delivery[], today: string, month: string): DeliverySummary {
  const active = deliveries.filter((item) => item.status !== "cancelled");
  const open = active.filter((item) => isOpenDelivery(item.status));
  const inMonth = active.filter((item) => item.scheduledOn.startsWith(month));
  const delivered = inMonth.filter((item) => item.status === "delivered");
  const cost = inMonth.reduce((sum, item) => sum + item.costMinor, 0);
  return {
    today: open.filter((item) => daysFrom(item.scheduledOn, today) === 0).length,
    next7: open.filter((item) => { const days = daysFrom(item.scheduledOn, today); return days >= 0 && days <= 7; }).length,
    overdue: open.filter((item) => daysFrom(item.scheduledOn, today) < 0).length,
    onTheWay: open.filter((item) => item.status === "on_the_way").length,
    delivered: delivered.length,
    failed: active.filter((item) => item.status === "failed").length,
    cost,
    averageCost: inMonth.length ? Math.round(cost / inMonth.length * 100) / 100 : null,
  };
}

/** `fillMissingCosts` completes, with today's cost, the products that had no complete cost when the sale was recorded. */
export type SalePatch = { soldOn?: string; channelId?: string | null; customer?: string; note?: string; items?: SaleRequest[]; deliveryCost?: number; fillMissingCosts?: boolean };

/** Whether a sale was recorded without a product's full cost and today's costs could complete it. */
export function canFillSaleCosts(sale: Pick<Sale, "items">, costs: ProductCost[]): boolean {
  return sale.items.some((item) => item.unitVariableCostMinor === null || item.unitCostMinor === null)
    && sale.items.every((item) => item.unitVariableCostMinor !== null && item.unitCostMinor !== null || Boolean(costs.find((cost) => cost.productId === item.productId)?.perUnit && costs.find((cost) => cost.productId === item.productId)?.unitMinor !== null));
}

/**
 * A corrected sale. Prices charged and each product's cost at the time of the sale are kept unless the person
 * changes them; a new product takes today's cost. Commission is recomputed only when the channel or items change,
 * and the delivery cost follows a new channel unless it is given.
 */
export function repriceSale(sale: Sale, patch: SalePatch, state: Pick<DomainState, "products"> & WithCurrency, costs: ProductCost[], channels: SalesChannel[]): { sale: Omit<Sale, "id" | "documentId" | "source" | "delivery">; problems: string[] } {
  const currency = state.organization?.currency;
  const channelChanged = patch.channelId !== undefined && (patch.channelId ?? null) !== sale.channelId;
  const channelId = patch.channelId !== undefined ? patch.channelId : sale.channelId;
  const channel = channelId ? channels.find((item) => item.id === channelId) : DIRECT_CHANNEL;
  if (!channel && (channelChanged || patch.items)) return { sale: { ...sale }, problems: ["Ese canal no existe"] };
  const recorded = new Map(sale.items.map((item) => [item.productId, item]));
  const itemsChanged = Boolean(patch.items) || Boolean(patch.fillMissingCosts);
  const quantity = (line: SaleItem) => line.quantityMilli / 1000;
  // What the sale recorded as its own costs per unit sold (packaging, bags): its selling cost without the channel's part.
  const before = sale.channelId ? channels.find((item) => item.id === sale.channelId) : DIRECT_CHANNEL;
  const recordedPerUnitSelling = before ? Math.max(0, sale.sellingCostMinor - sale.totalMinor * before.commissionBps / 10_000 - (sale.items.length ? before.feePerOrderMinor : 0)) : null;
  let lines = sale.items;
  let totalMinor = sale.totalMinor;
  let sellingCostMinor = sale.sellingCostMinor;
  let problems: string[] = [];
  if (patch.items && channel) {
    const requests: SaleRequest[] = patch.items.map((item) => ({ ...item, unitPrice: item.unitPrice ?? recorded.get(item.productId)?.unitPriceMinor }));
    // A product taken out of the catalog since the sale keeps what was recorded for it (price and costs); only its
    // quantity or price can change. A product that was never in the sale and no longer exists cannot be added.
    const inCatalog = new Set(state.products.map((product) => product.id));
    const retired = requests.filter((item) => !inCatalog.has(item.productId) && recorded.has(item.productId));
    const priced = priceSale(state, costs, channel, requests.filter((item) => !retired.includes(item)));
    problems = priced.problems;
    lines = [
      ...priced.items.map((line) => {
        const before = recorded.get(line.productId);
        return before ? { ...line, unitVariableCostMinor: before.unitVariableCostMinor, unitCostMinor: before.unitCostMinor } : line;
      }),
      ...retired.map((item): SaleItem => ({ ...recorded.get(item.productId)!, quantityMilli: Math.round(item.quantity * 1000), unitPriceMinor: roundMoney(item.unitPrice ?? recorded.get(item.productId)!.unitPriceMinor, currency) })),
    ];
    totalMinor = roundMoney(lines.reduce((sum, line) => sum + quantity(line) * line.unitPriceMinor, 0), currency);
    const retiredRevenue = retired.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? recorded.get(item.productId)!.unitPriceMinor), 0);
    // A retired product's cost per unit sold is what the sale recorded beyond the products still in the catalog.
    const catalogPerUnit = sale.items.filter((item) => inCatalog.has(item.productId)).reduce((sum, item) => sum + quantity(item) * (state.products.find((product) => product.id === item.productId)?.salesVariableMinor ?? 0), 0);
    const retiredUnitsBefore = sale.items.filter((item) => !inCatalog.has(item.productId)).reduce((sum, item) => sum + quantity(item), 0);
    const retiredPerUnit = recordedPerUnitSelling !== null && retiredUnitsBefore > 0 ? Math.max(0, recordedPerUnitSelling - catalogPerUnit) / retiredUnitsBefore : 0;
    const retiredSelling = retired.reduce((sum, item) => sum + item.quantity * retiredPerUnit, 0);
    sellingCostMinor = roundMoney(priced.sellingCostMinor + retiredRevenue * channel.commissionBps / 10_000 + retiredSelling + (!priced.items.length && retired.length ? channel.feePerOrderMinor : 0), currency);
  } else if (channelChanged && channel) {
    // Another channel with the same products: prices and costs stay as recorded; its commission and fee replace the
    // old channel's, and the sale's own costs per unit sold (packaging, bags) stay as they were recorded.
    const perUnitSelling = recordedPerUnitSelling
      ?? sale.items.reduce((sum, item) => sum + quantity(item) * (state.products.find((product) => product.id === item.productId)?.salesVariableMinor ?? 0), 0);
    sellingCostMinor = roundMoney(sale.totalMinor * channel.commissionBps / 10_000 + (sale.items.length ? channel.feePerOrderMinor : 0) + perUnitSelling, currency);
  }
  if (patch.fillMissingCosts) {
    // Only the missing costs are completed; what was known when the sale was recorded stays.
    lines = lines.map((line) => {
      if (line.unitVariableCostMinor !== null && line.unitCostMinor !== null) return line;
      const cost = costs.find((item) => item.productId === line.productId);
      return {
        ...line,
        unitVariableCostMinor: line.unitVariableCostMinor ?? (cost?.perUnit ? roundMoney(cost.perUnit.materialMinor + cost.perUnit.laborMinor, currency) : null),
        unitCostMinor: line.unitCostMinor ?? cost?.unitMinor ?? null,
      };
    });
  }
  const sumOf = (pick: (line: SaleItem) => number | null) => lines.every((line) => pick(line) !== null) ? roundMoney(lines.reduce((sum, line) => sum + quantity(line) * pick(line)!, 0), currency) : null;
  return {
    problems,
    sale: {
      soldOn: patch.soldOn ?? sale.soldOn,
      channelId: channel && channel.id !== DIRECT_CHANNEL.id ? channel.id : channelId ?? null,
      channelName: channelChanged && channel ? channel.name : sale.channelName,
      customer: patch.customer ?? sale.customer,
      note: patch.note ?? sale.note,
      items: lines, totalMinor, sellingCostMinor,
      deliveryCostMinor: roundMoney(patch.deliveryCost ?? (channelChanged && channel ? channel.deliveryCostPerOrderMinor : sale.deliveryCostMinor), currency),
      variableCostMinor: itemsChanged || channelChanged ? sumOf((line) => line.unitVariableCostMinor) : sale.variableCostMinor,
      productionCostMinor: itemsChanged || channelChanged ? sumOf((line) => line.unitCostMinor) : sale.productionCostMinor,
    },
  };
}

/** Short text for a sale's products: "3 × Tofu 300g, 2 × Tofu ahumado". */
export const saleItemsText = (items: Pick<SaleItem, "quantityMilli" | "productName">[]) => items.map((item) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(item.quantityMilli / 1000)} × ${item.productName}`).join(", ");

export const AREA_LABELS: Record<CostArea, string> = { production: "Producción", delivery: "Entregas", sales: "Ventas", admin: "Administración" };
export const AREA_HINTS: Record<CostArea, string> = {
  production: "Lo que cuesta tener el producto listo: el taller, su luz, sus sueldos.",
  delivery: "Lo que cuesta que el producto llegue al cliente: vehículo, combustible, repartidor, correo.",
  sales: "Lo que cuesta conseguir y cerrar ventas: publicidad, ferias, plataformas.",
  admin: "Lo que cuesta sostener la empresa: contador, software, banco, oficina.",
};
export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = { material: "Insumo", expense: "Gasto del mes", fixed_payment: "Pago de un gasto fijo", investment: "Inversión" };
export const PURCHASE_KIND_HINTS: Record<PurchaseKind, string> = {
  material: "Algo que va en la receta. No es un gasto del mes: se vuelve costo cuando vendes lo que produces con él.",
  expense: "Algo que se usa y se termina en el mes: cinta, limpieza, una reparación.",
  fixed_payment: "El pago de un gasto que ya tienes como mensual (luz, alquiler, sueldos).",
  investment: "Algo que dura años, como una herramienta o una computadora. Se reparte mes a mes durante su vida útil.",
};

/** Used when no channel is set up yet: selling directly, without commission or delivery. */
export const DIRECT_CHANNEL: SalesChannel = { id: "direct", name: "Venta directa", deliveryMethod: "Retiro", commissionBps: 0, feePerOrderMinor: 0, deliveryCostPerOrderMinor: 0, unitsPerOrderMilli: 1000, priceAdjustmentBps: 0 };

const round2 = (value: number) => Math.round(value * 100) / 100;

export function channelPrice(product: Pick<Product, "salePriceMinor">, channel: SalesChannel, currency?: string | null): number | null {
  if (product.salePriceMinor <= 0) return null;
  return roundMoney(product.salePriceMinor * (10_000 + channel.priceAdjustmentBps) / 10_000, currency);
}

export type ChannelEconomics = {
  productId: string;
  productName: string;
  channelId: string;
  channelName: string;
  price: number | null;
  /** Full cost of making one unit (materials, direct labor and the workshop's shared expenses). */
  productionCost: number | null;
  /** Materials plus direct labor: what each extra unit costs to make. */
  variableProductionCost: number | null;
  sellingCost: number | null;
  deliveryCost: number;
  /** What is left per unit after making, selling and delivering it; the company's structure is still to be covered. */
  left: number | null;
  leftPercent: number | null;
  /** What each unit leaves to cover all monthly fixed costs (price minus the costs that come with each sale). */
  contribution: number | null;
};

/** Per unit, for every product in every channel: price, what it costs to make, sell and deliver, and what is left. */
export function channelEconomics(state: Pick<DomainState, "products"> & WithCurrency, costs: ProductCost[], channels: SalesChannel[]): ChannelEconomics[] {
  const list = channels.length ? channels : [DIRECT_CHANNEL];
  return list.flatMap((channel) => state.products.map((product) => {
    const cost = costs.find((item) => item.productId === product.id);
    const price = channelPrice(product, channel, state.organization?.currency);
    const unitsPerOrder = Math.max(channel.unitsPerOrderMilli / 1000, 0.001);
    const deliveryCost = round2(channel.deliveryCostPerOrderMinor / unitsPerOrder);
    const sellingCost = price === null ? null : round2(price * channel.commissionBps / 10_000 + channel.feePerOrderMinor / unitsPerOrder + product.salesVariableMinor);
    const productionCost = cost?.unitMinor ?? null;
    const variableProductionCost = cost?.perUnit ? cost.perUnit.materialMinor + cost.perUnit.laborMinor : null;
    const left = price !== null && productionCost !== null && sellingCost !== null ? round2(price - productionCost - sellingCost - deliveryCost) : null;
    const contribution = price !== null && variableProductionCost !== null && sellingCost !== null ? round2(price - variableProductionCost - sellingCost - deliveryCost) : null;
    return {
      productId: product.id, productName: product.name, channelId: channel.id, channelName: channel.name,
      price, productionCost, variableProductionCost, sellingCost, deliveryCost, left,
      leftPercent: left !== null && price ? round2(left / price * 100) : null,
      contribution,
    };
  }));
}

export type SaleRequest = { productId: string; quantity: number; unitPrice?: number };

export type PricedSale = {
  items: SaleItem[];
  totalMinor: number;
  sellingCostMinor: number;
  deliveryCostMinor: number;
  variableCostMinor: number | null;
  productionCostMinor: number | null;
  problems: string[];
};

/** Prices a sale with the channel's rules and fixes its costs as of now. */
export function priceSale(state: Pick<DomainState, "products"> & WithCurrency, costs: ProductCost[], channel: SalesChannel, items: SaleRequest[], deliveryCost?: number): PricedSale {
  const currency = state.organization?.currency;
  const problems: string[] = [];
  const lines: SaleItem[] = [];
  let salesVariable = 0;
  for (const item of items) {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (!product) { problems.push("Un producto de la venta no existe"); continue; }
    if (!(item.quantity > 0)) { problems.push(`Falta la cantidad vendida de ${product.name}`); continue; }
    const price = item.unitPrice ?? channelPrice(product, channel, currency);
    if (price === null) { problems.push(`Falta el precio de venta de ${product.name}`); continue; }
    const cost = costs.find((entry) => entry.productId === product.id);
    lines.push({
      productId: product.id, productName: product.name, quantityMilli: Math.round(item.quantity * 1000), unitPriceMinor: roundMoney(price, currency),
      unitVariableCostMinor: cost?.perUnit ? cost.perUnit.materialMinor + cost.perUnit.laborMinor : null,
      unitCostMinor: cost?.unitMinor ?? null,
    });
    salesVariable += item.quantity * product.salesVariableMinor;
  }
  const quantity = (line: SaleItem) => line.quantityMilli / 1000;
  const totalMinor = roundMoney(lines.reduce((sum, line) => sum + quantity(line) * line.unitPriceMinor, 0), currency);
  const sumOf = (pick: (line: SaleItem) => number | null) => lines.every((line) => pick(line) !== null) ? roundMoney(lines.reduce((sum, line) => sum + quantity(line) * pick(line)!, 0), currency) : null;
  return {
    items: lines, totalMinor,
    sellingCostMinor: roundMoney(totalMinor * channel.commissionBps / 10_000 + (lines.length ? channel.feePerOrderMinor : 0) + salesVariable, currency),
    deliveryCostMinor: roundMoney(deliveryCost ?? channel.deliveryCostPerOrderMinor, currency),
    variableCostMinor: sumOf((line) => line.unitVariableCostMinor),
    productionCostMinor: sumOf((line) => line.unitCostMinor),
    problems,
  };
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/**
 * The part of an investment that belongs to a month: its price spread evenly over its useful life, in whole units
 * whose monthly roundings add up to exactly its price (the same share the unit cost uses).
 */
export function investmentShare(purchase: Pick<Purchase, "kind" | "amountMinor" | "purchasedOn" | "usefulLifeMonths">, month: string, currency?: string | null): number {
  if (purchase.kind !== "investment" || !purchase.usefulLifeMonths) return 0;
  return investmentMonthlyShare({ amountMinor: purchase.amountMinor, purchasedOn: purchase.purchasedOn, usefulLifeMonths: purchase.usefulLifeMonths }, month, currency);
}

/** Months of useful life still to spread, counting this one; before it was bought, its whole life. */
export function monthsLeft(purchase: Pick<Purchase, "purchasedOn" | "usefulLifeMonths">, month: string): number {
  if (!purchase.usefulLifeMonths) return 0;
  const elapsed = monthIndex(month) - monthIndex(purchase.purchasedOn.slice(0, 7));
  return Math.max(0, purchase.usefulLifeMonths - Math.max(0, elapsed));
}

const emptyAreas = (): Record<CostArea, number> => ({ production: 0, delivery: 0, sales: 0, admin: 0 });

export type CompanyStructure = {
  month: string;
  /** The costing period whose monthly expenses are in force this month; null before any was recorded. */
  period: string | null;
  areas: {
    area: CostArea;
    label: string;
    hint: string;
    expenses: { id: string; name: string; category: string; monthlyAmount: number }[];
    investments: { id: string; description: string; amount: number; monthlyShare: number; usefulLifeMonths: number; monthsLeft: number; includeInUnitCost: boolean; documentId?: string | null }[];
    monthlyTotal: number;
  }[];
  /** Monthly fixed costs of every area, including the workshop's, plus this month's share of investments. */
  monthlyFixedTotal: number;
};

/**
 * The company's monthly structure by area in a month: the fixed expenses in force that month and the investments
 * being spread over their useful life (bought on or before it and not yet fully spread).
 */
export function companyStructure(state: Pick<DomainState, "expenses" | "activePeriod"> & WithCurrency, investments: Purchase[], month: string, hasActivity = true): CompanyStructure {
  const currency = state.organization?.currency;
  const { period, expenses: active } = expensesInForce(state, month, hasActivity);
  const bought = (item: Purchase) => item.purchasedOn.slice(0, 7) <= month;
  const areas = (["production", "delivery", "sales", "admin"] as CostArea[]).map((area) => {
    const expenses = active.filter((item) => (item.area ?? "production") === area).map((item) => ({ id: item.id, name: item.name, category: item.category, monthlyAmount: item.amountMinor }));
    const assets = investments.filter((item) => item.kind === "investment" && item.area === area && item.usefulLifeMonths && bought(item))
      .map((item) => ({ id: item.id, description: item.description, amount: item.amountMinor, monthlyShare: investmentShare(item, month, currency), usefulLifeMonths: item.usefulLifeMonths!, monthsLeft: monthsLeft(item, month), includeInUnitCost: Boolean(item.includeInUnitCost), documentId: item.documentId }))
      .filter((item) => item.monthsLeft > 0);
    return {
      area, label: AREA_LABELS[area], hint: AREA_HINTS[area], expenses, investments: assets,
      monthlyTotal: roundMoney(expenses.reduce((sum, item) => sum + item.monthlyAmount, 0) + assets.reduce((sum, item) => sum + item.monthlyShare, 0), currency),
    };
  });
  return { month, period, areas, monthlyFixedTotal: roundMoney(areas.reduce((sum, item) => sum + item.monthlyTotal, 0), currency) };
}

/** A month has activity of its own when it has sales or purchases recorded. */
const monthHasActivity = (month: string, sales: Pick<Sale, "soldOn">[], purchases: Pick<Purchase, "purchasedOn">[]) =>
  sales.some((sale) => sale.soldOn.startsWith(month)) || purchases.some((purchase) => purchase.purchasedOn.startsWith(month));

export type MonthResult = {
  month: string;
  sales: number;
  revenue: number;
  /** Materials and direct labor of what was sold (recorded with each sale, or estimated with today's cost). */
  variableProductionCost: number;
  /** Part of `variableProductionCost` estimated with today's cost, for sales recorded without a product's full cost. */
  estimatedVariableCost: number;
  /** Sales recorded without a product's full cost whose cost was estimated with today's. */
  salesWithEstimatedCost: number;
  /** Sales with a product whose cost is still unknown: that part of their cost is not deducted. */
  salesWithoutCost: number;
  sellingCost: number;
  deliveryCost: number;
  /** What the sales left to cover the month's fixed costs. */
  contribution: number;
  fixedByArea: Record<CostArea, number>;
  fixedTotal: number;
  oneOffByArea: Record<CostArea, number>;
  oneOffTotal: number;
  investmentsShare: number;
  result: number;
  /** Cash that went into supplies and into paying fixed expenses: informative, already counted elsewhere. */
  purchasedMaterials: number;
  fixedPayments: { expenseName: string; paid: number; estimated: number | null }[];
  contributionRatio: number | null;
  breakEvenRevenue: number | null;
  /** The month has more records than were read, so its totals may be short. */
  incompleteRecords: boolean;
};

/**
 * What producing a sale's products cost (materials and direct labor). The cost recorded with the sale wins; a product
 * recorded without its full cost takes today's, marked as estimated; one still without a cost adds nothing and the
 * sale is counted as missing a cost.
 */
export function saleVariableCost(sale: Pick<Sale, "variableCostMinor" | "items">, costs: ProductCost[], currency?: string | null): { amount: number; estimated: number; usedToday: boolean; missing: boolean } {
  if (sale.variableCostMinor !== null) return { amount: sale.variableCostMinor, estimated: 0, usedToday: false, missing: false };
  if (!sale.items.length) return { amount: 0, estimated: 0, usedToday: false, missing: true };
  let recorded = 0;
  let estimated = 0;
  let usedToday = false;
  let missing = false;
  for (const item of sale.items) {
    const quantity = item.quantityMilli / 1000;
    if (item.unitVariableCostMinor !== null) { recorded += quantity * item.unitVariableCostMinor; continue; }
    const today = costs.find((cost) => cost.productId === item.productId)?.perUnit;
    if (today) { estimated += quantity * (today.materialMinor + today.laborMinor); usedToday = true; }
    else missing = true;
  }
  return { amount: roundMoney(recorded + estimated, currency), estimated: roundMoney(estimated, currency), usedToday, missing };
}

/**
 * The month in the order a person reads it: what came in, what each sale cost, what was left, the month's fixed
 * costs and the result. Fixed costs are the monthly amounts in force that month; supplies bought are not an expense
 * of the month (they become cost when what they made is sold), and an investment counts only its monthly share.
 */
export function monthResult(input: { state: Pick<DomainState, "expenses" | "activePeriod" | "products"> & WithCurrency; costs: ProductCost[]; channels: SalesChannel[]; month: string; sales: Sale[]; purchases: Purchase[]; investments: Purchase[]; incompleteRecords?: boolean }): MonthResult {
  const { month } = input;
  const currency = input.state.organization?.currency;
  // Sums of amounts that carry cents are rounded back to money, so no float residue reaches a total.
  const money = (value: number) => roundMoney(value, currency);
  const sum = <T,>(list: T[], pick: (item: T) => number) => money(list.reduce((total, item) => total + pick(item), 0));
  const sales = input.sales.filter((sale) => sale.soldOn.startsWith(month));
  const purchases = input.purchases.filter((purchase) => purchase.purchasedOn.startsWith(month));
  const revenue = sum(sales, (sale) => sale.totalMinor);
  const saleCosts = sales.map((sale) => saleVariableCost(sale, input.costs, currency));
  const variableProductionCost = sum(saleCosts, (cost) => cost.amount);
  const estimatedVariableCost = sum(saleCosts, (cost) => cost.estimated);
  const sellingCost = sum(sales, (sale) => sale.sellingCostMinor);
  const deliveryCost = sum(sales, (sale) => sale.deliveryCostMinor);
  const contribution = money(revenue - variableProductionCost - sellingCost - deliveryCost);

  const structure = companyStructure(input.state, input.investments, month, monthHasActivity(month, sales, purchases));
  const fixedByArea = emptyAreas();
  let investmentsShare = 0;
  for (const area of structure.areas) {
    fixedByArea[area.area] = sum(area.expenses, (item) => item.monthlyAmount);
    investmentsShare += area.investments.reduce((total, item) => total + item.monthlyShare, 0);
  }
  const fixedTotal = sum(Object.values(fixedByArea), (value) => value);
  const oneOffByArea = emptyAreas();
  for (const purchase of purchases.filter((item) => item.kind === "expense")) oneOffByArea[purchase.area] = money(oneOffByArea[purchase.area] + purchase.amountMinor);
  const oneOffTotal = sum(Object.values(oneOffByArea), (value) => value);
  investmentsShare = money(investmentsShare);

  // A payment may be for an expense of an earlier period: every expense row is looked up by its id.
  const expenses = new Map(input.state.expenses.map((item) => [item.id, item]));
  const fixedPayments = purchases.filter((item) => item.kind === "fixed_payment").map((item) => ({
    expenseName: item.expenseName ?? item.description, paid: item.amountMinor,
    estimated: item.expenseId ? expenses.get(item.expenseId)?.amountMinor ?? null : null,
  }));

  // Without sales this month, the ratio comes from the planned mix in the first channel.
  let contributionRatio: number | null = revenue > 0 ? contribution / revenue : null;
  if (contributionRatio === null) {
    const planned = channelEconomics(input.state, input.costs, input.channels.slice(0, 1));
    const weights = planned.map((row) => {
      const cost = input.costs.find((item) => item.productId === row.productId);
      return { row, units: cost?.monthly.assumedBatches === false ? cost.monthly.units : 1 };
    }).filter(({ row }) => row.price !== null && row.contribution !== null);
    const plannedRevenue = weights.reduce((sum, { row, units }) => sum + row.price! * units, 0);
    if (plannedRevenue > 0) contributionRatio = weights.reduce((sum, { row, units }) => sum + row.contribution! * units, 0) / plannedRevenue;
  }
  // Everything the month's sales have to cover, one-off purchases included: selling the break-even means not losing.
  const fixedToCover = fixedTotal + investmentsShare + oneOffTotal;
  return {
    month, sales: sales.length, revenue, variableProductionCost, estimatedVariableCost,
    salesWithEstimatedCost: saleCosts.filter((cost) => cost.usedToday && !cost.missing).length,
    salesWithoutCost: saleCosts.filter((cost) => cost.missing).length,
    sellingCost, deliveryCost, contribution,
    fixedByArea, fixedTotal, oneOffByArea, oneOffTotal, investmentsShare,
    result: money(contribution - fixedTotal - oneOffTotal - investmentsShare),
    purchasedMaterials: sum(purchases.filter((item) => item.kind === "material"), (item) => item.amountMinor),
    fixedPayments,
    contributionRatio: contributionRatio === null ? null : round2(contributionRatio * 10_000) / 10_000,
    breakEvenRevenue: contributionRatio && contributionRatio > 0 && fixedToCover > 0 ? money(fixedToCover / contributionRatio) : null,
    incompleteRecords: Boolean(input.incompleteRecords),
  };
}

export type MonthLesson = { id: string; title: string; text: string };

/** Short lessons written with the month's own numbers, for someone learning to read a result. */
export function monthLessons(result: MonthResult, money: (value: number) => string): MonthLesson[] {
  const lessons: MonthLesson[] = [];
  if (result.revenue > 0) {
    const kept = Math.round(result.contribution / result.revenue * 100);
    lessons.push({
      id: "contribution", title: "Lo que te deja cada venta",
      text: kept > 0
        ? `De cada $100 que vendiste, te quedaron $${kept} después de pagar lo que cuesta cada venta (insumos, mano de obra, comisiones y envío). Con esa parte se pagan los gastos fijos del mes.`
        : `Este mes, lo que cuesta cada venta se llevó todo lo que cobraste: vender más así no ayuda. Conviene revisar precios, comisiones o el costo de entrega.`,
    });
  }
  if (result.breakEvenRevenue !== null) {
    lessons.push({
      id: "break-even", title: "Tu punto de equilibrio",
      text: `Tus gastos del mes suman ${money(result.fixedTotal + result.investmentsShare + result.oneOffTotal)}${result.oneOffTotal ? ` (${money(result.oneOffTotal)} son compras que se usaron este mes)` : ""}. Para no perder necesitas vender unos ${money(result.breakEvenRevenue)} al mes; ${result.revenue > 0 ? result.revenue >= result.breakEvenRevenue ? `este mes vendiste ${money(result.revenue)}, así que lo superaste.` : `este mes vas ${money(result.revenue)}, te faltan ${money(result.breakEvenRevenue - result.revenue)}.` : "todavía no registraste ventas este mes."}`,
    });
  }
  if (result.purchasedMaterials > 0) {
    lessons.push({
      id: "materials", title: "Comprar no es gastar",
      text: `Este mes compraste ${money(result.purchasedMaterials)} en insumos. Salió plata de la caja, pero no es un gasto del mes: se vuelve costo cuando vendes lo que produces con esos insumos.`,
    });
  }
  if (result.investmentsShare > 0) {
    lessons.push({
      id: "investments", title: "Las inversiones se reparten",
      text: `Lo que compraste para que dure años (herramientas, equipos) no se carga entero en un mes: este mes suma ${money(result.investmentsShare)}, su parte según cuánto dura.`,
    });
  }
  const over = result.fixedPayments.filter((item) => item.estimated !== null && item.paid > item.estimated * 1.05);
  if (over.length) {
    const item = over[0];
    lessons.push({
      id: "estimate", title: "Estimado contra real",
      text: `Estimabas ${money(item.estimated!)} de ${item.expenseName} y pagaste ${money(item.paid)}. Si se repite, actualiza el monto mensual para que tus costos sigan siendo reales.`,
    });
  }
  return lessons;
}

/** `capped` when the month had more sales or purchases than were read. */
export type BusinessRecords = { channels: SalesChannel[]; purchases: Purchase[]; investments: Purchase[]; sales: Sale[]; capped?: boolean };

/** Everything the business sections show for a month, computed from the stored records. */
export function buildBusinessView(state: DomainState, records: BusinessRecords, month: string) {
  const costs = calculateCosts(state);
  return {
    month,
    currency: state.organization.currency,
    channels: records.channels,
    economics: channelEconomics(state, costs, records.channels),
    structure: companyStructure(state, records.investments, month, monthHasActivity(month, records.sales, records.purchases)),
    result: monthResult({ state, costs, channels: records.channels, month, sales: records.sales, purchases: records.purchases, investments: records.investments, incompleteRecords: records.capped }),
    purchases: records.purchases,
    investments: records.investments,
    sales: records.sales,
  };
}

export type BusinessView = ReturnType<typeof buildBusinessView>;

export type CustomerEntry = { name: string; address: string; contact: string; recipient: string; lastOn: string; sales: number };
export type CustomerDirectory = { customers: CustomerEntry[]; recipients: string[]; addresses: string[]; carriers: string[] };
export type DirectoryRow = { customer: string; soldOn: string; recipient?: string | null; address?: string | null; contact?: string | null; carrier?: string | null };

/**
 * What was already typed in sales and deliveries, most recent first: each customer with their last address and
 * contact, and the recipients, addresses and carriers used. Feeds the suggestions so nothing is typed twice.
 */
export function buildCustomerDirectory(rows: DirectoryRow[]): CustomerDirectory {
  const key = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  const customers = new Map<string, CustomerEntry>();
  const lists = { recipients: new Map<string, string>(), addresses: new Map<string, string>(), carriers: new Map<string, string>() };
  for (const row of [...rows].sort((a, b) => b.soldOn.localeCompare(a.soldOn))) {
    const name = row.customer.trim();
    if (name) {
      const entry = customers.get(key(name)) ?? { name, address: "", contact: "", recipient: "", lastOn: row.soldOn, sales: 0 };
      entry.sales += 1;
      entry.address ||= row.address?.trim() ?? "";
      entry.contact ||= row.contact?.trim() ?? "";
      entry.recipient ||= row.recipient?.trim() && key(row.recipient) !== key(name) ? row.recipient.trim() : "";
      customers.set(key(name), entry);
    }
    for (const [list, value] of [[lists.recipients, row.recipient], [lists.addresses, row.address], [lists.carriers, row.carrier]] as const) {
      const clean = value?.trim();
      if (clean && !list.has(key(clean))) list.set(key(clean), clean);
    }
  }
  return {
    customers: [...customers.values()].slice(0, 400),
    recipients: [...lists.recipients.values()].slice(0, 400),
    addresses: [...lists.addresses.values()].slice(0, 400),
    carriers: [...lists.carriers.values()].slice(0, 100),
  };
}

export type HistoryEvent = { id: string; at: string; who: string; byCozte: boolean; title: string; lines: string[] };

const FIELD_LABELS: Record<string, string> = {
  soldOn: "Fecha", channelId: "Canal", customer: "Cliente", note: "Nota", items: "Productos", deliveryCost: "Costo de entrega",
  scheduledOn: "Fecha de entrega", timeWindow: "Franja", status: "Estado", method: "Forma de entrega", carrier: "Quién entrega", recipient: "Recibe",
  address: "Dirección", contact: "Contacto", tracking: "Seguimiento", deliveredOn: "Entregada el", cost: "Costo de entrega",
  purchasedOn: "Fecha", description: "Descripción", supplier: "Proveedor", amount: "Monto", area: "Área", usefulLifeMonths: "Vida útil (meses)",
};

const TITLES: Record<string, string> = {
  "record-sale": "Venta registrada", "update-sale": "Venta corregida", "archive-sale": "Venta anulada",
  "create-delivery": "Entrega creada", "update-delivery": "Entrega actualizada", "archive-delivery": "Entrega quitada",
  "record-purchase": "Compra registrada", "update-purchase": "Compra corregida", "archive-purchase": "Compra anulada",
};

/** One change in plain words: what happened and, field by field, what it became (and what it was, when known). */
export function describeHistoryEvent(action: string, details: Record<string, unknown>, money: (value: number) => string): { title: string; lines: string[] } {
  const show = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "vacío";
    if (key === "status" && typeof value === "string" && value in DELIVERY_STATUS_LABELS) return DELIVERY_STATUS_LABELS[value as DeliveryStatus];
    if (key === "area" && typeof value === "string" && value in AREA_LABELS) return AREA_LABELS[value as CostArea];
    if ((key === "amount" || key === "deliveryCost" || key === "cost") && typeof value === "number") return money(value);
    if (key === "channelId") return value === null ? "Venta directa" : "otro canal";
    if (key === "items" && Array.isArray(value)) return value.map((item) => { const line = item as { quantity?: number; productName?: string; productId?: string; quantityMilli?: number }; return `${line.quantity ?? (line.quantityMilli ?? 0) / 1000} × ${line.productName ?? "producto"}`; }).join(", ");
    return String(value);
  };
  const lines: string[] = [];
  const before = (details.before ?? null) as Record<string, unknown> | null;
  const patch = (details.patch ?? (action.startsWith("update") || action === "create-delivery" ? details : null)) as Record<string, unknown> | null;
  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in FIELD_LABELS) || value === undefined) continue;
      const beforeKey = key === "deliveryCost" ? "deliveryCostMinor" : key;
      const previous = before ? before[beforeKey] : undefined;
      lines.push(previous !== undefined && key !== "items" && key !== "channelId" ? `${FIELD_LABELS[key]}: ${show(key, previous)} → ${show(key, value)}` : `${FIELD_LABELS[key]}: ${show(key, value)}`);
    }
  }
  if (action === "record-sale" && typeof details.totalMinor === "number") lines.push(`Total: ${money(details.totalMinor)}${typeof details.channel === "string" ? ` por ${details.channel}` : ""}`);
  if (action === "record-purchase" && typeof details.amount === "number") lines.push(`${typeof details.description === "string" ? details.description : "Compra"}: ${money(details.amount)}`);
  if (action.startsWith("archive") && typeof details.reason === "string" && details.reason) lines.push(`Motivo: ${details.reason}`);
  if (action === "archive-delivery" && typeof details.deliveryCostBefore === "number") lines.push(`Costo de entrega de la venta: ${money(details.deliveryCostBefore)} → ${money(0)}`);
  return { title: TITLES[action] ?? action, lines };
}
