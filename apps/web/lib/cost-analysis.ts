import { calculateCosts, type CostLine, type DomainState, type Product, type SharedExpense } from "./domain";

/** A stored cost snapshot row (one per product per confirmed change). */
export type SnapshotRow = { product_id: string; total_lot_minor: number | null; unit_minor: number | null; lines_json: string; warnings_json: string; context_json: string; created_at: string };

export type Granularity = "week" | "month";
export type ComponentType = "insumo" | "mano de obra" | "gasto compartido";
export type ComponentMeta = { key: string; label: string; type: ComponentType; category: string };

export type ProductPoint = {
  period: string;
  unitCost: number | null;
  lotCost: number | null;
  monthlyCost: number | null;
  /** Cost per finished unit by concept (material, direct labor, each shared expense). */
  components: Record<string, number>;
  incomplete: boolean;
  carried: boolean;
};

export type Driver = { key: string; label: string; delta: number };
export type Insight = { kind: "increase" | "decrease" | "concentration" | "price" | "data"; severity: "info" | "warning" | "risk"; title: string; detail: string };

export type CostAnalysis = {
  granularity: Granularity;
  currency: string;
  periods: string[];
  components: ComponentMeta[];
  products: { id: string; name: string; points: ProductPoint[]; change: { from: number; to: number; delta: number; deltaPercent: number; drivers: Driver[] } | null }[];
  totals: { period: string; monthlyProductionCost: number | null; productsWithVolume: number; productsWithCost: number }[];
  insights: Insight[];
  snapshotCount: number;
};

type SnapshotContext = {
  product?: Partial<Product>;
  materials?: { id: string; name: string; category?: string; priceMinor?: number | null }[];
  expenses?: SharedExpense[];
  allocationPeers?: { id: string; lotUnits: number; productionHoursMilli: number; batchesPerMonthMilli?: number | null }[];
  activePeriod?: string;
};

const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Monday-based week start (UTC) or calendar month, as a sortable key. */
export function periodKey(isoDate: string, granularity: Granularity): string {
  const date = new Date(isoDate.includes("T") ? isoDate : `${isoDate.replace(" ", "T")}Z`);
  if (granularity === "month") return date.toISOString().slice(0, 7);
  const day = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Consecutive period keys from first to last, so gaps in activity still show on the time axis. */
export function periodRange(first: string, last: string, granularity: Granularity): string[] {
  const keys: string[] = [];
  if (granularity === "month") {
    let [year, month] = first.split("-").map(Number);
    const [lastYear, lastMonth] = last.split("-").map(Number);
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      keys.push(`${year}-${String(month).padStart(2, "0")}`);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return keys;
  }
  for (let cursor = new Date(`${first}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= last; cursor = new Date(cursor.getTime() + 7 * 86_400_000)) keys.push(cursor.toISOString().slice(0, 10));
  return keys;
}

/** Splits the snapshot's shared-expense line per expense by re-running the allocation with the peers of that moment. */
function sharedByExpense(productId: string, context: SnapshotContext, sharedLot: number): Record<string, number> {
  const expenses = context.expenses ?? [];
  if (!sharedLot || !expenses.length || !context.allocationPeers?.length) return sharedLot ? { __shared: sharedLot } : {};
  const period = context.activePeriod ?? expenses[0].period;
  const state: DomainState = {
    revision: 0, activePeriod: period, organization: { id: "analysis", name: "", currency: "CLP" },
    products: context.allocationPeers.map((peer) => ({ id: peer.id, name: peer.id, lotUnits: Math.max(peer.lotUnits, 1), salePriceMinor: 0, salesVariableMinor: 0, laborLotMinor: 0, productionHoursMilli: peer.productionHoursMilli, batchesPerMonthMilli: peer.batchesPerMonthMilli ?? null, version: 1 })),
    materials: [], components: [], expenses: expenses.map((expense) => ({ ...expense, period, fxMissing: false })),
  };
  try {
    const cost = calculateCosts(state).find((item) => item.productId === productId);
    const byExpense = cost?.monthly.sharedByExpense ?? {};
    const total = Object.values(byExpense).reduce((sum, value) => sum + value, 0);
    if (!total) return { __shared: sharedLot };
    // Distribute the snapshot's own shared amount by the reconstructed weights, so parts always add up to what was stored.
    return Object.fromEntries(Object.entries(byExpense).map(([id, value]) => [id, sharedLot * value / total]));
  } catch {
    return { __shared: sharedLot };
  }
}

type Decomposed = { at: string; productId: string; name: string; point: Omit<ProductPoint, "period" | "carried">; meta: ComponentMeta[]; prices: Record<string, { name: string; price: number }> };

function decompose(row: SnapshotRow, fallbackName: string): Decomposed {
  const context = parse<SnapshotContext>(row.context_json, {});
  const lines = parse<CostLine[]>(row.lines_json, []);
  const warnings = parse<string[]>(row.warnings_json, []);
  const lotUnits = Math.max(context.product?.lotUnits ?? 1, 1);
  const materials = new Map((context.materials ?? []).map((item) => [item.id, item]));
  const expenses = new Map((context.expenses ?? []).map((item) => [item.id, item]));
  const components: Record<string, number> = {};
  const meta: ComponentMeta[] = [];
  const add = (item: ComponentMeta, lotAmount: number) => {
    components[item.key] = (components[item.key] ?? 0) + lotAmount / lotUnits;
    if (!meta.some((entry) => entry.key === item.key)) meta.push(item);
  };
  for (const line of lines) {
    if (line.kind === "material") {
      const material = line.materialId ? materials.get(line.materialId) : undefined;
      add({ key: `m:${line.materialId ?? line.label}`, label: line.label, type: "insumo", category: material?.category || "Insumos" }, line.amountMinor);
    } else if (line.kind === "labor") {
      if (line.amountMinor) add({ key: "labor", label: "Mano de obra por lote", type: "mano de obra", category: "Mano de obra directa" }, line.amountMinor);
    } else {
      for (const [id, amount] of Object.entries(sharedByExpense(row.product_id, context, line.amountMinor))) {
        const expense = expenses.get(id);
        add(id === "__shared" ? { key: "e:shared", label: "Gastos compartidos", type: "gasto compartido", category: "Gastos compartidos" } : { key: `e:${id}`, label: expense?.name ?? "Gasto", type: "gasto compartido", category: expense?.category || "Gastos compartidos" }, amount);
      }
    }
  }
  const batches = context.product?.batchesPerMonthMilli;
  const prices = Object.fromEntries((context.materials ?? []).filter((item) => typeof item.priceMinor === "number").map((item) => [item.id, { name: item.name, price: item.priceMinor as number }]));
  return {
    at: row.created_at, productId: row.product_id, name: context.product?.name ?? fallbackName, meta, prices,
    point: {
      unitCost: row.unit_minor, lotCost: row.total_lot_minor,
      monthlyCost: row.total_lot_minor !== null && batches ? round2(row.total_lot_minor * batches / 1000) : null,
      components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round2(value)])),
      incomplete: row.unit_minor === null || warnings.length > 0,
    },
  };
}

const money = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(value));
const percent = (value: number) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value)} %`;

/** Time series, change drivers and deterministic insights from the stored snapshots. */
export function analyzeCosts(rows: SnapshotRow[], options: { granularity: Granularity; currency: string; productNames?: Record<string, string> }): CostAnalysis {
  const { granularity, currency } = options;
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const decomposed = ordered.map((row) => decompose(row, options.productNames?.[row.product_id] ?? "Producto"));
  const empty: CostAnalysis = { granularity, currency, periods: [], components: [], products: [], totals: [], insights: [], snapshotCount: rows.length };
  if (!decomposed.length) return { ...empty, insights: [{ kind: "data", severity: "info", title: "Todavía no hay historial", detail: "Cada cambio confirmado en costos guarda una foto. Con dos o más fotos en el tiempo aparece la evolución." }] };

  const periods = periodRange(periodKey(decomposed[0].at, granularity), periodKey(decomposed.at(-1)!.at, granularity), granularity);
  const componentMeta = new Map<string, ComponentMeta>();
  for (const item of decomposed) for (const entry of item.meta) componentMeta.set(entry.key, entry);

  const productIds = [...new Set(decomposed.map((item) => item.productId))];
  const products = productIds.map((productId) => {
    const own = decomposed.filter((item) => item.productId === productId);
    const name = options.productNames?.[productId] ?? own.at(-1)!.name;
    const points: ProductPoint[] = [];
    let last: Decomposed | null = null;
    for (const period of periods) {
      const inPeriod = own.filter((item) => periodKey(item.at, granularity) === period);
      const current = inPeriod.at(-1) ?? null;
      if (current) last = current;
      if (last) points.push({ period, ...last.point, carried: !current });
    }
    const complete = points.filter((point) => point.unitCost !== null && !point.incomplete);
    const first = complete[0];
    const latest = complete.at(-1);
    let change: CostAnalysis["products"][number]["change"] = null;
    if (first && latest && first !== latest && first.unitCost !== null && latest.unitCost !== null) {
      const keys = new Set([...Object.keys(first.components), ...Object.keys(latest.components)]);
      const drivers = [...keys].map((key) => ({ key, label: componentMeta.get(key)?.label ?? key, delta: round2((latest.components[key] ?? 0) - (first.components[key] ?? 0)) }))
        .filter((driver) => Math.abs(driver.delta) >= 0.5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      change = { from: first.unitCost, to: latest.unitCost, delta: latest.unitCost - first.unitCost, deltaPercent: first.unitCost ? round2((latest.unitCost - first.unitCost) / first.unitCost * 100) : 0, drivers };
    }
    return { id: productId, name, points, change };
  });

  const totals = periods.map((period) => {
    const points = products.map((product) => product.points.find((point) => point.period === period)).filter((point): point is ProductPoint => Boolean(point));
    const withCost = points.filter((point) => point.lotCost !== null && !point.incomplete);
    const withVolume = withCost.filter((point) => point.monthlyCost !== null);
    return { period, monthlyProductionCost: withVolume.length && withVolume.length === withCost.length ? round2(withVolume.reduce((sum, point) => sum + (point.monthlyCost ?? 0), 0)) : null, productsWithVolume: withVolume.length, productsWithCost: withCost.length };
  });

  const insights: Insight[] = [];
  for (const product of products) {
    if (product.change && Math.abs(product.change.deltaPercent) >= 3) {
      const main = product.change.drivers[0];
      const up = product.change.delta > 0;
      insights.push({
        kind: up ? "increase" : "decrease", severity: up && product.change.deltaPercent >= 10 ? "risk" : up ? "warning" : "info",
        title: `El costo de ${product.name} ${up ? "subió" : "bajó"} ${percent(Math.abs(product.change.deltaPercent))}`,
        detail: `Pasó de ${currency} ${money(product.change.from)} a ${currency} ${money(product.change.to)} por unidad.${main ? ` Lo explica sobre todo ${main.label} (${main.delta > 0 ? "+" : "−"}${currency} ${money(Math.abs(main.delta))} por unidad).` : ""}`,
      });
    }
    const latest = [...product.points].reverse().find((point) => point.unitCost !== null && !point.incomplete);
    if (latest?.unitCost) {
      const [key, value] = Object.entries(latest.components).sort((a, b) => b[1] - a[1])[0] ?? [];
      const share = key ? value / latest.unitCost * 100 : 0;
      if (key && share >= 35) insights.push({
        kind: "concentration", severity: share >= 50 ? "risk" : "warning",
        title: `${componentMeta.get(key)?.label ?? key} pesa ${percent(share)} del costo de ${product.name}`,
        detail: `Si ese concepto sube 10 %, el costo por unidad sube cerca de ${percent(share / 10)} (${currency} ${money(value * 0.1)}). Es el primer lugar para negociar o buscar eficiencia.`,
      });
    }
    const lastPoint = product.points.at(-1);
    if (lastPoint?.incomplete) insights.push({ kind: "data", severity: "warning", title: `El costo de ${product.name} está incompleto`, detail: "Falta algún dato esencial (por ejemplo, el precio de un insumo); el análisis usa la última foto completa." });
  }
  const firstPrices = decomposed[0].prices;
  const lastPrices: Record<string, { name: string; price: number }> = {};
  for (const item of decomposed) Object.assign(lastPrices, item.prices);
  const seenFirst: Record<string, number> = {};
  for (const item of decomposed) for (const [id, price] of Object.entries(item.prices)) if (!(id in seenFirst)) seenFirst[id] = price.price;
  for (const [id, latest] of Object.entries(lastPrices)) {
    const initial = seenFirst[id] ?? firstPrices[id]?.price;
    if (!initial || initial === latest.price) continue;
    const change = (latest.price - initial) / initial * 100;
    if (Math.abs(change) >= 10) insights.push({ kind: "price", severity: change > 0 ? "warning" : "info", title: `${latest.name} ${change > 0 ? "subió" : "bajó"} ${percent(Math.abs(change))}`, detail: `El precio pasó de ${currency} ${money(initial)} a ${currency} ${money(latest.price)} por unidad de compra en el período analizado.` });
  }
  if (periods.length < 2) insights.push({ kind: "data", severity: "info", title: "El historial recién empieza", detail: `Hay ${rows.length === 1 ? "una foto" : `${rows.length} fotos`} en un mismo período. La evolución se vuelve útil cuando registres cambios de precios, gastos o volumen a lo largo de las semanas.` });

  const severity = { risk: 0, warning: 1, info: 2 };
  insights.sort((a, b) => severity[a.severity] - severity[b.severity]);
  return { granularity, currency, periods, components: [...componentMeta.values()], products, totals, insights, snapshotCount: rows.length };
}

/** Groups per-unit components by type, category or concept for charting. */
export function groupComponents(point: ProductPoint, meta: ComponentMeta[], by: "type" | "category" | "concept"): Record<string, number> {
  const grouped: Record<string, number> = {};
  for (const [key, value] of Object.entries(point.components)) {
    const item = meta.find((entry) => entry.key === key);
    const label = by === "concept" ? item?.label ?? key : by === "category" ? item?.category ?? "Otros" : item?.type === "insumo" ? "Insumos" : item?.type === "mano de obra" ? "Mano de obra directa" : "Gastos compartidos";
    grouped[label] = round2((grouped[label] ?? 0) + value);
  }
  return grouped;
}
