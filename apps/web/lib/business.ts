import { calculateCosts, type CostArea, type DomainState, type Product, type ProductCost } from "./domain";

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
  amountMinor: number;
  kind: PurchaseKind;
  area: CostArea;
  materialName?: string | null;
  quantityMilli?: number | null;
  expenseId?: string | null;
  expenseName?: string | null;
  usefulLifeMonths?: number | null;
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
};

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

export function channelPrice(product: Pick<Product, "salePriceMinor">, channel: SalesChannel): number | null {
  if (product.salePriceMinor <= 0) return null;
  return Math.round(product.salePriceMinor * (10_000 + channel.priceAdjustmentBps) / 10_000);
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
export function channelEconomics(state: Pick<DomainState, "products">, costs: ProductCost[], channels: SalesChannel[]): ChannelEconomics[] {
  const list = channels.length ? channels : [DIRECT_CHANNEL];
  return list.flatMap((channel) => state.products.map((product) => {
    const cost = costs.find((item) => item.productId === product.id);
    const price = channelPrice(product, channel);
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
export function priceSale(state: Pick<DomainState, "products">, costs: ProductCost[], channel: SalesChannel, items: SaleRequest[], deliveryCost?: number): PricedSale {
  const problems: string[] = [];
  const lines: SaleItem[] = [];
  let salesVariable = 0;
  for (const item of items) {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (!product) { problems.push("Un producto de la venta no existe"); continue; }
    if (!(item.quantity > 0)) { problems.push(`Falta la cantidad vendida de ${product.name}`); continue; }
    const price = item.unitPrice ?? channelPrice(product, channel);
    if (price === null) { problems.push(`Falta el precio de venta de ${product.name}`); continue; }
    const cost = costs.find((entry) => entry.productId === product.id);
    lines.push({
      productId: product.id, productName: product.name, quantityMilli: Math.round(item.quantity * 1000), unitPriceMinor: Math.round(price),
      unitVariableCostMinor: cost?.perUnit ? cost.perUnit.materialMinor + cost.perUnit.laborMinor : null,
      unitCostMinor: cost?.unitMinor ?? null,
    });
    salesVariable += item.quantity * product.salesVariableMinor;
  }
  const quantity = (line: SaleItem) => line.quantityMilli / 1000;
  const totalMinor = Math.round(lines.reduce((sum, line) => sum + quantity(line) * line.unitPriceMinor, 0));
  const sumOf = (pick: (line: SaleItem) => number | null) => lines.every((line) => pick(line) !== null) ? Math.round(lines.reduce((sum, line) => sum + quantity(line) * pick(line)!, 0)) : null;
  return {
    items: lines, totalMinor,
    sellingCostMinor: Math.round(totalMinor * channel.commissionBps / 10_000 + (lines.length ? channel.feePerOrderMinor : 0) + salesVariable),
    deliveryCostMinor: Math.round(deliveryCost ?? channel.deliveryCostPerOrderMinor),
    variableCostMinor: sumOf((line) => line.unitVariableCostMinor),
    productionCostMinor: sumOf((line) => line.unitCostMinor),
    problems,
  };
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** The part of an investment that belongs to a month: its price spread evenly over its useful life. */
export function investmentShare(purchase: Pick<Purchase, "kind" | "amountMinor" | "purchasedOn" | "usefulLifeMonths">, month: string): number {
  if (purchase.kind !== "investment" || !purchase.usefulLifeMonths) return 0;
  const elapsed = monthIndex(month) - monthIndex(purchase.purchasedOn.slice(0, 7));
  return elapsed >= 0 && elapsed < purchase.usefulLifeMonths ? purchase.amountMinor / purchase.usefulLifeMonths : 0;
}

export function monthsLeft(purchase: Pick<Purchase, "purchasedOn" | "usefulLifeMonths">, month: string): number {
  if (!purchase.usefulLifeMonths) return 0;
  return Math.max(0, purchase.usefulLifeMonths - (monthIndex(month) - monthIndex(purchase.purchasedOn.slice(0, 7))));
}

const emptyAreas = (): Record<CostArea, number> => ({ production: 0, delivery: 0, sales: 0, admin: 0 });

export type CompanyStructure = {
  month: string;
  areas: {
    area: CostArea;
    label: string;
    hint: string;
    expenses: { id: string; name: string; category: string; monthlyAmount: number }[];
    investments: { id: string; description: string; amount: number; monthlyShare: number; usefulLifeMonths: number; monthsLeft: number; documentId?: string | null }[];
    monthlyTotal: number;
  }[];
  /** Monthly fixed costs of every area, including the workshop's, plus this month's share of investments. */
  monthlyFixedTotal: number;
};

/** The company's monthly structure by area: fixed expenses and investments spread over their useful life. */
export function companyStructure(state: Pick<DomainState, "expenses" | "activePeriod">, investments: Purchase[], month: string): CompanyStructure {
  const active = state.expenses.filter((item) => item.period === state.activePeriod);
  const areas = (["production", "delivery", "sales", "admin"] as CostArea[]).map((area) => {
    const expenses = active.filter((item) => (item.area ?? "production") === area).map((item) => ({ id: item.id, name: item.name, category: item.category, monthlyAmount: item.amountMinor }));
    const assets = investments.filter((item) => item.kind === "investment" && item.area === area && item.usefulLifeMonths)
      .map((item) => ({ id: item.id, description: item.description, amount: item.amountMinor, monthlyShare: round2(investmentShare(item, month)), usefulLifeMonths: item.usefulLifeMonths!, monthsLeft: monthsLeft(item, month), documentId: item.documentId }))
      .filter((item) => item.monthsLeft > 0);
    return {
      area, label: AREA_LABELS[area], hint: AREA_HINTS[area], expenses, investments: assets,
      monthlyTotal: round2(expenses.reduce((sum, item) => sum + item.monthlyAmount, 0) + assets.reduce((sum, item) => sum + item.monthlyShare, 0)),
    };
  });
  return { month, areas, monthlyFixedTotal: round2(areas.reduce((sum, item) => sum + item.monthlyTotal, 0)) };
}

export type MonthResult = {
  month: string;
  sales: number;
  revenue: number;
  /** Materials and direct labor of what was sold. */
  variableProductionCost: number;
  /** Sales whose products had no complete cost when they were recorded. */
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
};

/**
 * The month in the order a person reads it: what came in, what each sale cost, what was left, the month's fixed
 * costs and the result. Fixed costs are the monthly amounts in force; supplies bought are not an expense of the
 * month (they become cost when what they made is sold), and an investment counts only its monthly share.
 */
export function monthResult(input: { state: Pick<DomainState, "expenses" | "activePeriod" | "products">; costs: ProductCost[]; channels: SalesChannel[]; month: string; sales: Sale[]; purchases: Purchase[]; investments: Purchase[] }): MonthResult {
  const { month } = input;
  const sales = input.sales.filter((sale) => sale.soldOn.startsWith(month));
  const purchases = input.purchases.filter((purchase) => purchase.purchasedOn.startsWith(month));
  const revenue = sales.reduce((sum, sale) => sum + sale.totalMinor, 0);
  const variableProductionCost = sales.reduce((sum, sale) => sum + (sale.variableCostMinor ?? 0), 0);
  const sellingCost = sales.reduce((sum, sale) => sum + sale.sellingCostMinor, 0);
  const deliveryCost = sales.reduce((sum, sale) => sum + sale.deliveryCostMinor, 0);
  const contribution = revenue - variableProductionCost - sellingCost - deliveryCost;

  const structure = companyStructure(input.state, input.investments, month);
  const fixedByArea = emptyAreas();
  let investmentsShare = 0;
  for (const area of structure.areas) {
    fixedByArea[area.area] = round2(area.expenses.reduce((sum, item) => sum + item.monthlyAmount, 0));
    investmentsShare += area.investments.reduce((sum, item) => sum + item.monthlyShare, 0);
  }
  const fixedTotal = round2(Object.values(fixedByArea).reduce((sum, value) => sum + value, 0));
  const oneOffByArea = emptyAreas();
  for (const purchase of purchases.filter((item) => item.kind === "expense")) oneOffByArea[purchase.area] += purchase.amountMinor;
  const oneOffTotal = Object.values(oneOffByArea).reduce((sum, value) => sum + value, 0);
  investmentsShare = round2(investmentsShare);

  const expenses = new Map(input.state.expenses.filter((item) => item.period === input.state.activePeriod).map((item) => [item.id, item]));
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
  const fixedToCover = fixedTotal + investmentsShare;
  return {
    month, sales: sales.length, revenue, variableProductionCost,
    salesWithoutCost: sales.filter((sale) => sale.variableCostMinor === null).length,
    sellingCost, deliveryCost, contribution,
    fixedByArea, fixedTotal, oneOffByArea, oneOffTotal, investmentsShare,
    result: round2(contribution - fixedTotal - oneOffTotal - investmentsShare),
    purchasedMaterials: purchases.filter((item) => item.kind === "material").reduce((sum, item) => sum + item.amountMinor, 0),
    fixedPayments,
    contributionRatio: contributionRatio === null ? null : round2(contributionRatio * 10_000) / 10_000,
    breakEvenRevenue: contributionRatio && contributionRatio > 0 && fixedToCover > 0 ? Math.round(fixedToCover / contributionRatio) : null,
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
      text: `Tus gastos fijos del mes suman ${money(result.fixedTotal + result.investmentsShare)}. Para no perder necesitas vender unos ${money(result.breakEvenRevenue)} al mes; ${result.revenue > 0 ? result.revenue >= result.breakEvenRevenue ? `este mes vendiste ${money(result.revenue)}, así que lo superaste.` : `este mes vas ${money(result.revenue)}, te faltan ${money(result.breakEvenRevenue - result.revenue)}.` : "todavía no registraste ventas este mes."}`,
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

export type BusinessRecords = { channels: SalesChannel[]; purchases: Purchase[]; investments: Purchase[]; sales: Sale[] };

/** Everything the business sections show for a month, computed from the stored records. */
export function buildBusinessView(state: DomainState, records: BusinessRecords, month: string) {
  const costs = calculateCosts(state);
  return {
    month,
    currency: state.organization.currency,
    channels: records.channels,
    economics: channelEconomics(state, costs, records.channels),
    structure: companyStructure(state, records.investments, month),
    result: monthResult({ state, costs, channels: records.channels, month, sales: records.sales, purchases: records.purchases, investments: records.investments }),
    purchases: records.purchases,
    investments: records.investments,
    sales: records.sales,
  };
}

export type BusinessView = ReturnType<typeof buildBusinessView>;
