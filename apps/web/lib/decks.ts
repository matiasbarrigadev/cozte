import { AREA_LABELS, PURCHASE_KIND_LABELS, monthLessons, type BusinessView } from "./business";
import type { CostAnalysis } from "./cost-analysis";
import { resolveEntity } from "./cozte-cost-view";
import { productionCostSources, type DomainState, type ProductCost } from "./domain";

/**
 * Presentations built from the business's own data. Every chart and figure is computed by the engine when a slide
 * is created (or its data refreshed) and frozen into the deck, so a shared link shows exactly what the deck says
 * and a model can write the words but never the numbers. Pure functions: the server, the demo and the tests share them.
 */

export type DeckTheme = "cozte" | "noche" | "claro" | "terracota";
export const DECK_THEMES: Record<DeckTheme, { label: string; hint: string }> = {
  cozte: { label: "Cozte", hint: "Papel cálido con acento lima" },
  noche: { label: "Noche", hint: "Fondo oscuro, ideal para proyectar" },
  claro: { label: "Claro", hint: "Blanco y azul, sobrio para informes" },
  terracota: { label: "Terracota", hint: "Crema y terracota, cercano" },
};
export const DECK_THEME_KEYS = Object.keys(DECK_THEMES) as DeckTheme[];
export const isDeckTheme = (value: unknown): value is DeckTheme => typeof value === "string" && value in DECK_THEMES;

export type SlideLayout = "cover" | "section" | "bullets" | "chart" | "kpis" | "comparison" | "closing";
export const SLIDE_LAYOUTS: Record<SlideLayout, { label: string; hint: string }> = {
  cover: { label: "Portada", hint: "Título, subtítulo, empresa y período" },
  section: { label: "Mensaje clave", hint: "Una idea grande, para abrir un tema o destacar un resultado" },
  bullets: { label: "Puntos", hint: "Título y hasta 6 puntos" },
  chart: { label: "Gráfico", hint: "Un gráfico con datos reales y su conclusión al lado" },
  kpis: { label: "Cifras", hint: "De 1 a 4 cifras grandes del negocio" },
  comparison: { label: "Comparación", hint: "Dos columnas: antes y después, fortalezas y a mejorar…" },
  closing: { label: "Cierre", hint: "Resumen o próximos pasos numerados" },
};
export const SLIDE_LAYOUT_KEYS = Object.keys(SLIDE_LAYOUTS) as SlideLayout[];

export type ChartKind = "unit-cost" | "cost-breakdown" | "margins" | "production" | "channels" | "month-result" | "break-even"
  | "sales-by-channel" | "sales-by-product" | "sales-by-day" | "deliveries" | "expenses-by-area" | "cost-evolution" | "purchases";
export const CHART_KINDS: Record<ChartKind, { label: string; hint: string; needsProduct?: boolean; usesMonth?: boolean; usesHistory?: boolean }> = {
  "unit-cost": { label: "Costo por unidad", hint: "Cuánto cuesta hacer cada producto y en qué se va (insumos, mano de obra, gastos del taller)" },
  "cost-breakdown": { label: "Desglose del costo", hint: "Cada insumo, la mano de obra y cada gasto dentro del costo de una unidad", needsProduct: true },
  margins: { label: "Margen por producto", hint: "Precio de venta menos costo de fabricar, por unidad" },
  production: { label: "Producción del mes", hint: "Unidades que se producen al mes de cada producto" },
  channels: { label: "Te queda por canal", hint: "Lo que deja cada unidad en cada canal después de producir, vender y entregar" },
  "month-result": { label: "Resultado del mes", hint: "De lo vendido al resultado: cada costo que se descuenta, en cascada", usesMonth: true },
  "break-even": { label: "Punto de equilibrio", hint: "Cuánto se vendió contra lo que hay que vender para no perder", usesMonth: true },
  "sales-by-channel": { label: "Ventas por canal", hint: "Lo vendido en cada canal en el mes", usesMonth: true },
  "sales-by-product": { label: "Ventas por producto", hint: "Lo vendido de cada producto en el mes, con unidades", usesMonth: true },
  "sales-by-day": { label: "Ventas por día", hint: "Lo vendido cada día del mes", usesMonth: true },
  deliveries: { label: "Entregas por canal", hint: "Pedidos entregados en cada canal y lo que costó entregarlos", usesMonth: true },
  "expenses-by-area": { label: "Gastos fijos por área", hint: "La estructura mensual de producción, entregas, ventas y administración", usesMonth: true },
  "cost-evolution": { label: "Evolución del costo", hint: "Cómo cambió el costo por unidad de cada producto mes a mes", usesHistory: true },
  purchases: { label: "Compras del mes", hint: "Las compras e inversiones del mes con su tipo y área", usesMonth: true },
};
export const CHART_KIND_KEYS = Object.keys(CHART_KINDS) as ChartKind[];

export type MetricFormat = "money" | "count" | "percent";
export type MetricKey = "revenue" | "result" | "contribution" | "fixed-costs" | "break-even" | "sales-count" | "units-sold" | "average-ticket"
  | "deliveries" | "delivery-cost" | "selling-cost" | "purchases-total" | "products" | "monthly-units" | "unit-cost" | "sale-price" | "unit-margin" | "margin-percent";
export const METRICS: Record<MetricKey, { label: string; hint: string; format: MetricFormat; perProduct?: boolean; usesMonth?: boolean }> = {
  revenue: { label: "Ventas del mes", hint: "Todo lo cobrado en el mes", format: "money", usesMonth: true },
  result: { label: "Resultado del mes", hint: "Ganancia o pérdida después de todos los costos del mes", format: "money", usesMonth: true },
  contribution: { label: "Lo que dejaron las ventas", hint: "Ventas menos lo que cuesta cada venta (margen de contribución)", format: "money", usesMonth: true },
  "fixed-costs": { label: "Gastos fijos del mes", hint: "Estructura mensual de todas las áreas más la parte de las inversiones", format: "money", usesMonth: true },
  "break-even": { label: "Punto de equilibrio", hint: "Lo que hay que vender en el mes para no perder", format: "money", usesMonth: true },
  "sales-count": { label: "Ventas registradas", hint: "Cantidad de ventas del mes", format: "count", usesMonth: true },
  "units-sold": { label: "Unidades vendidas", hint: "Unidades de todos los productos vendidas en el mes", format: "count", usesMonth: true },
  "average-ticket": { label: "Venta promedio", hint: "Lo cobrado en promedio por venta", format: "money", usesMonth: true },
  deliveries: { label: "Pedidos entregados", hint: "Ventas del mes con costo de entrega", format: "count", usesMonth: true },
  "delivery-cost": { label: "Costo de entregas", hint: "Lo que costó entregar los pedidos del mes", format: "money", usesMonth: true },
  "selling-cost": { label: "Comisiones y cargos", hint: "Lo que se llevaron los canales por vender", format: "money", usesMonth: true },
  "purchases-total": { label: "Compras del mes", hint: "Todo lo comprado en el mes (insumos, gastos, pagos e inversiones)", format: "money", usesMonth: true },
  products: { label: "Productos", hint: "Productos que se costean", format: "count" },
  "monthly-units": { label: "Unidades al mes", hint: "Unidades que se producen en un mes normal", format: "count" },
  "unit-cost": { label: "Costo por unidad", hint: "Lo que cuesta fabricar una unidad", format: "money", perProduct: true },
  "sale-price": { label: "Precio de venta", hint: "Precio de lista por unidad", format: "money", perProduct: true },
  "unit-margin": { label: "Margen por unidad", hint: "Precio menos costo de fabricar", format: "money", perProduct: true },
  "margin-percent": { label: "Margen", hint: "Qué parte del precio queda después de fabricar", format: "percent", perProduct: true },
};
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export type DeckTemplate = "ventas" | "costos" | "produccion" | "entregas" | "resultado";
export const DECK_TEMPLATES: Record<DeckTemplate, { label: string; hint: string; title: string }> = {
  ventas: { label: "Informe de ventas", hint: "Cuánto se vendió, por canal, por producto y por día, y qué deja cada canal", title: "Informe de ventas" },
  costos: { label: "Costos de producción", hint: "Costo por unidad, en qué se va, márgenes y cómo evolucionó", title: "Costos de producción" },
  produccion: { label: "Producción", hint: "Qué y cuánto se produce al mes y lo que cuesta", title: "Producción del mes" },
  entregas: { label: "Entregas y canales", hint: "Pedidos entregados, costo de entregar y lo que queda por canal", title: "Entregas y canales" },
  resultado: { label: "Resultado del mes", hint: "De las ventas al resultado, punto de equilibrio y estructura", title: "Resultado del mes" },
};
export const DECK_TEMPLATE_KEYS = Object.keys(DECK_TEMPLATES) as DeckTemplate[];

/** One bar. Rows that share a group (a product, when a chart compares several) are drawn under its heading. */
export type BarRow = { label: string; value: number; note?: string; tone?: "negative"; group?: string };
export type ChartData =
  | { type: "bars"; unit: MetricFormat; rows: BarRow[]; total: number | null }
  | { type: "stacked"; keys: { key: string; label: string }[]; rows: { label: string; total: number; parts: Record<string, number> }[] }
  | { type: "columns"; unit: MetricFormat; rows: { label: string; value: number }[] }
  | { type: "waterfall"; steps: { label: string; value: number; kind: "start" | "minus" | "result" }[] }
  | { type: "progress"; value: number; target: number; valueLabel: string; targetLabel: string }
  | { type: "line"; periods: string[]; series: { label: string; values: (number | null)[] }[] }
  | { type: "table"; columns: string[]; align: ("left" | "right")[]; rows: string[][] }
  | { type: "empty"; message: string };

export type ChartSnapshot = { kind: ChartKind; productId: string | null; month: string | null; title: string; caption: string | null; insight: string | null; data: ChartData };
export type Kpi = { metric: MetricKey; productId: string | null; month: string | null; label: string; value: number | null; format: MetricFormat; note: string | null };
export type SlideColumn = { title: string; bullets: string[] };

export type Slide = {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  text?: string;
  bullets?: string[];
  left?: SlideColumn;
  right?: SlideColumn;
  chart?: ChartSnapshot;
  kpis?: Kpi[];
  notes?: string;
};

export type Deck = {
  subtitle: string;
  /** Default month for the deck's monthly charts and figures (AAAA-MM). */
  month: string;
  currency: string;
  organization: string;
  /** When the figures were last computed. */
  dataAt: string;
  slides: Slide[];
};

export type Presentation = {
  id: string;
  title: string;
  theme: DeckTheme;
  deck: Deck;
  revision: number;
  shareUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PresentationSummary = Omit<Presentation, "deck"> & { slideCount: number; cover: Slide | null; deck: Omit<Deck, "slides"> };

/** What a slide is asked to be: by Cozte, by a template or by the editor. Charts and figures are named, never given. */
export type SlideInput = {
  layout?: SlideLayout;
  title: string;
  subtitle?: string;
  text?: string;
  bullets?: string[];
  left?: SlideColumn;
  right?: SlideColumn;
  chart?: ChartKind;
  product?: string;
  month?: string;
  metrics?: MetricKey[];
  notes?: string;
};

export type SlideChanges = Partial<Omit<SlideInput, "chart" | "metrics">> & { chart?: ChartKind | null; metrics?: MetricKey[] | null };

export type DeckOperation =
  | { action: "add"; slide: SlideInput; position?: number }
  | { action: "update"; slide: number; set: SlideChanges }
  | { action: "remove"; slide: number }
  | { action: "move"; slide: number; to: number }
  | { action: "duplicate"; slide: number }
  | { action: "settings"; title?: string; subtitle?: string; theme?: DeckTheme; month?: string }
  | { action: "refresh" };

export type DeckMeta = { title: string; theme: DeckTheme };

export type DeckSources = {
  state: DomainState;
  costs: ProductCost[];
  /** Business view of each month the deck needs. */
  views: Record<string, BusinessView>;
  analysis: CostAnalysis | null;
  now: string;
};

export class DeckError extends Error {
  constructor(message: string, public options: string[] = []) { super(message); }
}

export const MAX_SLIDES = 20;
export const LIMITS = { title: 140, subtitle: 200, text: 600, bullet: 300, bullets: 6, columnBullets: 5, notes: 1500, metrics: 4 } as const;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (value: unknown): value is string => typeof value === "string" && MONTH.test(value);

export function monthLabel(month: string): string {
  if (!isMonth(month)) return month;
  const text = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Readable money for slides and insights: whole amounts, a minus sign for negatives. */
export function formatMoney(value: number, currency: string): string {
  const text = new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: Math.abs(value) < 100 && currency !== "CLP" ? 2 : 0 }).format(Math.abs(value));
  return value < -0.004 ? `−${text}` : text;
}

export function formatValue(value: number | null, format: MetricFormat, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (format === "money") return formatMoney(value, currency);
  if (format === "percent") return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)} %`;
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value);
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const pct = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;
const clip = (value: string | undefined, max: number) => value === undefined ? undefined : value.trim().slice(0, max);
const cleanList = (items: string[] | undefined, max: number, length: number) => items?.map((item) => item.trim()).filter(Boolean).slice(0, max).map((item) => item.slice(0, length));

export function newSlideId(): string {
  return `s-${Math.random().toString(36).slice(2, 10)}`;
}

function view(sources: DeckSources, month: string): BusinessView {
  const found = sources.views[month];
  if (!found) throw new DeckError(`No hay datos cargados de ${monthLabel(month)}.`);
  return found;
}

function resolveProduct(sources: DeckSources, reference: string | undefined, required: boolean): string | null {
  const products = sources.state.products;
  if (!reference) {
    if (!required) return null;
    if (products.length === 1) return products[0].id;
    throw new DeckError(products.length ? "Falta indicar de qué producto." : "Todavía no hay productos cargados.", products.map((item) => item.name));
  }
  const found = resolveEntity(products, reference);
  if (!found.item) throw new DeckError(`No identifiqué el producto "${reference}".`, found.candidates);
  return found.item.id;
}

const productName = (sources: DeckSources, id: string | null) => sources.state.products.find((item) => item.id === id)?.name ?? "";

function salesOf(sources: DeckSources, month: string) {
  return view(sources, month).sales.filter((sale) => sale.soldOn.startsWith(month));
}

function empty(message: string): ChartData { return { type: "empty", message }; }

/** Computes a chart from the engine and writes a one-sentence conclusion with its own numbers. */
export function buildChart(kind: ChartKind, productId: string | null, month: string, sources: DeckSources): ChartSnapshot {
  const { state, costs } = sources;
  const currency = state.organization.currency;
  const money = (value: number) => formatMoney(value, currency);
  const meta = CHART_KINDS[kind];
  const base = { kind, productId, month: meta.usesMonth ? month : null, caption: null as string | null, insight: null as string | null };
  const period = monthLabel(month);
  switch (kind) {
    case "unit-cost": {
      const rows = state.products.flatMap((product) => {
        const cost = costs.find((item) => item.productId === product.id);
        return cost?.unitMinor != null && cost.perUnit ? [{ label: product.name, total: round2(cost.unitMinor), parts: { materials: round2(cost.perUnit.materialMinor), labor: round2(cost.perUnit.laborMinor), shared: round2(cost.perUnit.sharedMinor) } }] : [];
      }).sort((a, b) => b.total - a.total).slice(0, 10);
      const missing = state.products.filter((product) => !rows.some((row) => row.label === product.name)).map((product) => product.name);
      if (!rows.length) return { ...base, title: meta.label, data: empty("Todavía no hay productos con el costo completo."), caption: null };
      const top = rows[0];
      const labels: Record<string, string> = { materials: "los insumos", labor: "la mano de obra", shared: "los gastos del taller" };
      const [biggest, amount] = Object.entries(top.parts).sort((a, b) => b[1] - a[1])[0];
      return {
        ...base, title: meta.label,
        caption: missing.length ? `Sin costo completo todavía: ${missing.slice(0, 4).join(", ")}.` : null,
        insight: rows.length > 1
          ? `${top.label} es el que más cuesta hacer: ${money(top.total)} por unidad, y ${labels[biggest]} son el ${pct(amount, top.total)} % de ese costo.`
          : `Cada ${top.label} cuesta ${money(top.total)}; ${labels[biggest]} son el ${pct(amount, top.total)} % del costo.`,
        data: { type: "stacked", keys: [{ key: "materials", label: "Insumos" }, { key: "labor", label: "Mano de obra" }, { key: "shared", label: "Gastos del taller" }], rows },
      };
    }
    case "cost-breakdown": {
      const product = state.products.find((item) => item.id === productId);
      const cost = product ? costs.find((item) => item.productId === product.id) : undefined;
      if (!product || !cost) return { ...base, title: meta.label, data: empty("No encontré ese producto.") };
      const lotUnits = Math.max(product.lotUnits, 1);
      const names = new Map(productionCostSources(state).map((item) => [item.id, item.name]));
      const rows: BarRow[] = [
        ...cost.lines.filter((line) => line.kind === "material" && line.amountMinor > 0).map((line) => ({ label: line.label, value: round2(line.amountMinor / lotUnits) })),
        ...(cost.perUnit?.laborMinor ? [{ label: "Mano de obra directa", value: round2(cost.perUnit.laborMinor) }] : []),
        ...Object.entries(cost.monthly.sharedByExpense).map(([id, monthly]) => ({ label: names.get(id) ?? "Gasto compartido", value: round2(monthly / Math.max(cost.monthly.units, 1)) })),
      ].filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
      const total = round2(cost.unitMinor ?? cost.partialUnitMinor);
      if (!rows.length) return { ...base, title: `En qué se va el costo de ${product.name}`, data: empty("Todavía no tiene insumos ni gastos asociados.") };
      return {
        ...base, title: `En qué se va el costo de ${product.name}`,
        caption: cost.unitMinor === null ? "Costo conocido hasta ahora: faltan datos para completarlo." : `Costo por unidad: ${money(total)}.`,
        insight: `En ${product.name}, lo que más pesa es ${rows[0].label}: ${money(rows[0].value)} de cada unidad, el ${pct(rows[0].value, total)} % del costo.`,
        data: { type: "bars", unit: "money", rows, total },
      };
    }
    case "margins": {
      const rows: BarRow[] = state.products.flatMap((product) => {
        const cost = costs.find((item) => item.productId === product.id);
        if (!cost || cost.unitMinor === null || product.salePriceMinor <= 0) return [];
        const value = round2(product.salePriceMinor - cost.unitMinor);
        return [{ label: product.name, value, note: `Precio ${money(product.salePriceMinor)} − costo ${money(cost.unitMinor)}`, ...(value < 0 ? { tone: "negative" as const } : {}) }];
      }).sort((a, b) => b.value - a.value).slice(0, 10);
      if (!rows.length) return { ...base, title: meta.label, data: empty("Falta el precio de venta o el costo completo de los productos.") };
      const losing = rows.filter((row) => row.value < 0);
      return {
        ...base, title: meta.label, caption: "Precio de venta menos costo de fabricar, por unidad (antes de comisiones y entregas).",
        insight: losing.length
          ? `${losing[0].label} se vende por debajo de lo que cuesta fabricarlo: pierde ${money(-losing[0].value)} por unidad.`
          : `${rows[0].label} es el que más deja: ${money(rows[0].value)} por unidad antes de vender y entregar.`,
        data: { type: "bars", unit: "money", rows, total: null },
      };
    }
    case "production": {
      const rows: BarRow[] = state.products.map((product) => {
        const cost = costs.find((item) => item.productId === product.id);
        const lots = (product.batchesPerMonthMilli ?? 0) / 1000;
        const units = cost?.monthly.units ?? product.lotUnits * Math.max(lots, 1);
        return { label: product.name, value: Math.round(units), note: `${lots ? `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(lots)} lotes de ${product.lotUnits}` : `lote de ${product.lotUnits} (lotes al mes sin definir)`}` };
      }).sort((a, b) => b.value - a.value).slice(0, 10);
      if (!rows.length) return { ...base, title: meta.label, data: empty("Todavía no hay productos cargados.") };
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const assumed = state.products.filter((product) => !product.batchesPerMonthMilli).map((product) => product.name);
      return {
        ...base, title: meta.label,
        caption: assumed.length ? `Con 1 lote al mes supuesto para: ${assumed.slice(0, 4).join(", ")}.` : "Unidades buenas de un mes normal.",
        insight: rows.length > 1 ? `Se producen unas ${formatValue(total, "count", currency)} unidades al mes; ${rows[0].label} es el ${pct(rows[0].value, total)} %.` : `Se producen unas ${formatValue(total, "count", currency)} unidades de ${rows[0].label} al mes.`,
        data: { type: "bars", unit: "count", rows, total },
      };
    }
    case "channels": {
      const economics = view(sources, month).economics.filter((row) => row.left !== null && (!productId || row.productId === productId));
      const products = [...new Set(economics.map((row) => row.productName))];
      const grouped = products.length > 1;
      const toRow = (row: (typeof economics)[number]): BarRow => ({ label: row.channelName, value: round2(row.left!), note: `Precio ${money(row.price ?? 0)} − producir ${money(row.productionCost ?? 0)} − vender ${money(row.sellingCost ?? 0)} − entregar ${money(row.deliveryCost)}`, ...(grouped ? { group: row.productName } : {}), ...(row.left! < 0 ? { tone: "negative" as const } : {}) });
      // Several products: grouped by product (best first), each product's channels from most to least.
      const best = (name: string) => Math.max(...economics.filter((row) => row.productName === name).map((row) => row.left!));
      const rows: BarRow[] = [...products].sort((x, y) => best(y) - best(x)).flatMap((name) => economics.filter((row) => row.productName === name).map(toRow).sort((x, y) => y.value - x.value)).slice(0, 12);
      const title = productId ? `Te queda por canal · ${productName(sources, productId)}` : meta.label;
      if (!rows.length) return { ...base, title, data: empty("Falta el precio de venta o el costo completo para calcularlo.") };
      const where = (row: BarRow) => row.group ? `${row.group} en ${row.label}` : row.label;
      const sorted = [...rows].sort((x, y) => y.value - x.value);
      const [top, worst] = [sorted[0], sorted.at(-1)!];
      return {
        ...base, title, caption: "Lo que queda por unidad después de producir, vender y entregar.",
        insight: rows.length > 1 ? `${where(top)} es donde más queda: ${money(top.value)} por unidad; ${worst.value < 0 ? `${where(worst)} pierde ${money(-worst.value)}` : `${where(worst)} deja ${money(worst.value)}`}.` : `En ${rows[0].label} quedan ${money(rows[0].value)} por unidad.`,
        data: { type: "bars", unit: "money", rows, total: null },
      };
    }
    case "month-result": {
      const result = view(sources, month).result;
      const title = `Resultado de ${period}`;
      if (!result.sales && !result.fixedTotal) return { ...base, title, data: empty(`No hay ventas ni gastos registrados en ${period}.`) };
      const steps = [
        { label: "Ventas", value: result.revenue, kind: "start" as const },
        { label: "Producir lo vendido", value: result.variableProductionCost, kind: "minus" as const },
        { label: "Comisiones y cargos", value: result.sellingCost, kind: "minus" as const },
        { label: "Entregas", value: result.deliveryCost, kind: "minus" as const },
        { label: "Gastos fijos", value: result.fixedTotal, kind: "minus" as const },
        { label: "Gastos del mes", value: result.oneOffTotal, kind: "minus" as const },
        { label: "Inversiones (parte del mes)", value: result.investmentsShare, kind: "minus" as const },
      ].filter((step) => step.kind === "start" || step.value > 0).map((step) => ({ ...step, value: round2(step.value) }));
      return {
        ...base, title, caption: result.salesWithoutCost ? `${result.salesWithoutCost} venta(s) sin costo completo al registrarse.` : null,
        insight: result.result >= 0
          ? `De ${money(result.revenue)} vendidos quedaron ${money(result.result)} de ganancia después de pagar todo.`
          : `Con ${money(result.revenue)} vendidos no alcanzó para cubrir los costos: el mes cerró con una pérdida de ${money(-result.result)}.`,
        data: { type: "waterfall", steps: [...steps, { label: result.result >= 0 ? "Ganancia" : "Pérdida", value: round2(result.result), kind: "result" }] },
      };
    }
    case "break-even": {
      const result = view(sources, month).result;
      const title = `Punto de equilibrio · ${period}`;
      if (result.breakEvenRevenue === null) return { ...base, title, data: empty("Falta saber cuánto deja cada venta (precios y costos) para calcularlo.") };
      const progress = pct(result.revenue, result.breakEvenRevenue);
      return {
        ...base, title, caption: `Gastos fijos del mes: ${money(result.fixedTotal + result.investmentsShare)}.`,
        insight: result.revenue >= result.breakEvenRevenue
          ? `Se vendieron ${money(result.revenue)}: el ${progress} % de lo necesario para no perder (${money(result.breakEvenRevenue)}). Lo superaste.`
          : `Para no perder hay que vender ${money(result.breakEvenRevenue)} al mes; van ${money(result.revenue)} (${progress} %), faltan ${money(result.breakEvenRevenue - result.revenue)}.`,
        data: { type: "progress", value: round2(result.revenue), target: round2(result.breakEvenRevenue), valueLabel: "Vendido", targetLabel: "Para no perder" },
      };
    }
    case "sales-by-channel": {
      const sales = salesOf(sources, month);
      const title = `Ventas por canal · ${period}`;
      if (!sales.length) return { ...base, title, data: empty(`No hay ventas registradas en ${period}.`) };
      const byChannel = new Map<string, { value: number; count: number }>();
      for (const sale of sales) {
        const entry = byChannel.get(sale.channelName) ?? { value: 0, count: 0 };
        entry.value += sale.totalMinor; entry.count += 1;
        byChannel.set(sale.channelName, entry);
      }
      const total = round2(sales.reduce((sum, sale) => sum + sale.totalMinor, 0));
      const rows = [...byChannel].map(([label, entry]) => ({ label, value: round2(entry.value), note: `${entry.count} venta${entry.count === 1 ? "" : "s"}` })).sort((a, b) => b.value - a.value).slice(0, 10);
      return {
        ...base, title, caption: `Total: ${money(total)} en ${sales.length} venta${sales.length === 1 ? "" : "s"}.`,
        insight: rows.length > 1 ? `${rows[0].label} fue el canal que más vendió: ${money(rows[0].value)}, el ${pct(rows[0].value, total)} % del mes.` : `Todo se vendió por ${rows[0].label}: ${money(total)}.`,
        data: { type: "bars", unit: "money", rows, total },
      };
    }
    case "sales-by-product": {
      const sales = salesOf(sources, month);
      const title = `Ventas por producto · ${period}`;
      if (!sales.length) return { ...base, title, data: empty(`No hay ventas registradas en ${period}.`) };
      const byProduct = new Map<string, { value: number; units: number }>();
      for (const item of sales.flatMap((sale) => sale.items)) {
        const entry = byProduct.get(item.productName) ?? { value: 0, units: 0 };
        entry.value += item.unitPriceMinor * item.quantityMilli / 1000; entry.units += item.quantityMilli / 1000;
        byProduct.set(item.productName, entry);
      }
      const total = round2([...byProduct.values()].reduce((sum, entry) => sum + entry.value, 0));
      const rows = [...byProduct].map(([label, entry]) => ({ label, value: round2(entry.value), note: `${formatValue(entry.units, "count", currency)} unidades` })).sort((a, b) => b.value - a.value).slice(0, 10);
      if (!rows.length) return { ...base, title, data: empty(`Las ventas de ${period} no tienen productos detallados.`) };
      return {
        ...base, title, caption: `Total: ${money(total)}.`,
        insight: rows.length > 1 ? `${rows[0].label} fue lo más vendido: ${money(rows[0].value)} (${rows[0].note}), el ${pct(rows[0].value, total)} % de las ventas.` : `Todo lo vendido fue ${rows[0].label}: ${rows[0].note}.`,
        data: { type: "bars", unit: "money", rows, total },
      };
    }
    case "sales-by-day": {
      const sales = salesOf(sources, month);
      const title = `Ventas por día · ${period}`;
      if (!sales.length) return { ...base, title, data: empty(`No hay ventas registradas en ${period}.`) };
      const [year, monthNumber] = month.split("-").map(Number);
      const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      const totals = Array.from({ length: days }, () => 0);
      for (const sale of sales) totals[Number(sale.soldOn.slice(8, 10)) - 1] += sale.totalMinor;
      const rows = totals.map((value, index) => ({ label: String(index + 1), value: round2(value) }));
      const best = rows.reduce((top, row) => row.value > top.value ? row : top, rows[0]);
      const activeDays = rows.filter((row) => row.value > 0).length;
      return {
        ...base, title, caption: `Vendiste en ${activeDays} de ${days} días.`,
        insight: `El mejor día fue el ${best.label}: ${money(best.value)}, el ${pct(best.value, rows.reduce((sum, row) => sum + row.value, 0))} % del mes.`,
        data: { type: "columns", unit: "money", rows },
      };
    }
    case "deliveries": {
      const current = view(sources, month);
      const sales = salesOf(sources, month);
      const title = `Entregas · ${period}`;
      if (!sales.length) return { ...base, title, data: empty(`No hay ventas registradas en ${period}.`) };
      const methods = new Map(current.channels.map((channel) => [channel.name, channel.deliveryMethod]));
      const byChannel = new Map<string, { count: number; cost: number }>();
      for (const sale of sales) {
        const entry = byChannel.get(sale.channelName) ?? { count: 0, cost: 0 };
        entry.count += 1; entry.cost += sale.deliveryCostMinor;
        byChannel.set(sale.channelName, entry);
      }
      const rows = [...byChannel].map(([label, entry]) => ({ label: methods.get(label) ? `${label} · ${methods.get(label)}` : label, value: entry.count, note: entry.cost ? `Entregar costó ${money(entry.cost)} (${money(entry.cost / entry.count)} por pedido)` : "Sin costo de entrega" }))
        .sort((a, b) => b.value - a.value).slice(0, 10);
      const cost = sales.reduce((sum, sale) => sum + sale.deliveryCostMinor, 0);
      const delivered = sales.filter((sale) => sale.deliveryCostMinor > 0).length;
      return {
        ...base, title, caption: `Pedidos por canal y forma de entrega.`,
        insight: cost > 0 ? `Se entregaron ${delivered} pedidos con costo; entregar costó ${money(cost)}, unos ${money(cost / delivered)} por pedido.` : `Ninguna venta de ${period} tuvo costo de entrega.`,
        data: { type: "bars", unit: "count", rows, total: sales.length },
      };
    }
    case "expenses-by-area": {
      const structure = view(sources, month).structure;
      const rows = structure.areas.filter((area) => area.monthlyTotal > 0).map((area) => ({ label: area.label, value: round2(area.monthlyTotal), note: [...area.expenses.map((item) => item.name), ...area.investments.map((item) => item.description)].slice(0, 4).join(", ") })).sort((a, b) => b.value - a.value);
      if (!rows.length) return { ...base, title: meta.label, data: empty("Todavía no hay gastos mensuales cargados.") };
      const total = round2(structure.monthlyFixedTotal);
      return {
        ...base, title: meta.label, caption: `Incluye la parte del mes de las inversiones. Total: ${money(total)} al mes.`,
        insight: `La estructura fija suma ${money(total)} al mes; ${rows[0].label} es el área que más pesa (${pct(rows[0].value, total)} %).`,
        data: { type: "bars", unit: "money", rows, total },
      };
    }
    case "cost-evolution": {
      const analysis = sources.analysis;
      if (!analysis || analysis.periods.length < 2) return { ...base, title: meta.label, data: empty("La evolución aparece a partir del segundo mes con costos guardados.") };
      const products = analysis.products.slice(0, 6);
      const label = (value: string) => new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`));
      const changed = analysis.products.filter((product) => product.change).sort((a, b) => Math.abs(b.change!.deltaPercent) - Math.abs(a.change!.deltaPercent))[0];
      return {
        ...base, title: meta.label, caption: "Costo por unidad de cada producto, por mes.",
        insight: changed?.change ? `El costo de ${changed.name} pasó de ${money(changed.change.from)} a ${money(changed.change.to)} (${changed.change.deltaPercent > 0 ? "+" : ""}${Math.round(changed.change.deltaPercent)} %).` : null,
        data: { type: "line", periods: analysis.periods.map(label), series: products.map((product) => ({ label: product.name, values: analysis.periods.map((value) => { const point = product.points.find((item) => item.period === value && !item.incomplete); return point?.unitCost == null ? null : round2(point.unitCost); }) })) },
      };
    }
    case "purchases": {
      const purchases = view(sources, month).purchases.filter((item) => item.purchasedOn.startsWith(month));
      const title = `Compras de ${period}`;
      if (!purchases.length) return { ...base, title, data: empty(`No hay compras registradas en ${period}.`) };
      const total = purchases.reduce((sum, item) => sum + item.amountMinor, 0);
      const investments = purchases.filter((item) => item.kind === "investment");
      const date = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
      return {
        ...base, title, caption: purchases.length > 8 ? `Las 8 más recientes de ${purchases.length}.` : null,
        insight: `En ${period} se compraron ${money(total)}${investments.length ? `; ${investments.length === 1 ? "una fue inversión" : `${investments.length} fueron inversiones`} (${money(investments.reduce((sum, item) => sum + item.amountMinor, 0))}), que se reparten en los meses que duran` : ""}.`,
        data: { type: "table", columns: ["Fecha", "Compra", "Tipo", "Área", "Monto"], align: ["left", "left", "left", "left", "right"], rows: purchases.slice(0, 8).map((item) => [date(item.purchasedOn), item.description, PURCHASE_KIND_LABELS[item.kind], AREA_LABELS[item.area], money(item.amountMinor)]) },
      };
    }
  }
}

/** Computes one figure from the engine. */
export function buildKpi(metric: MetricKey, productId: string | null, month: string, sources: DeckSources): Kpi {
  const meta = METRICS[metric];
  const base = { metric, productId: meta.perProduct ? productId : null, month: meta.usesMonth ? month : null, label: meta.label, format: meta.format };
  const period = monthLabel(month);
  if (meta.perProduct) {
    const product = sources.state.products.find((item) => item.id === productId);
    const cost = sources.costs.find((item) => item.productId === productId);
    const unit = cost?.unitMinor ?? null;
    const price = product && product.salePriceMinor > 0 ? product.salePriceMinor : null;
    const value = metric === "unit-cost" ? unit : metric === "sale-price" ? price
      : metric === "unit-margin" ? (unit !== null && price !== null ? price - unit : null)
      : cost?.estimatedMarginPercent ?? null;
    return { ...base, value: value === null ? null : round2(value), note: product?.name ?? null };
  }
  if (metric === "products") return { ...base, value: sources.state.products.length, note: null };
  if (metric === "monthly-units") return { ...base, value: Math.round(sources.costs.reduce((sum, cost) => sum + cost.monthly.units, 0)), note: "En un mes normal" };
  const current = view(sources, month);
  const result = current.result;
  const sales = current.sales.filter((sale) => sale.soldOn.startsWith(month));
  const values: Record<string, number | null> = {
    revenue: result.revenue, result: result.result, contribution: result.contribution,
    "fixed-costs": result.fixedTotal + result.investmentsShare, "break-even": result.breakEvenRevenue,
    "sales-count": result.sales, "units-sold": sales.reduce((sum, sale) => sum + sale.items.reduce((total, item) => total + item.quantityMilli / 1000, 0), 0),
    "average-ticket": result.sales ? result.revenue / result.sales : null,
    deliveries: sales.filter((sale) => sale.deliveryCostMinor > 0).length, "delivery-cost": result.deliveryCost, "selling-cost": result.sellingCost,
    "purchases-total": current.purchases.filter((item) => item.purchasedOn.startsWith(month)).reduce((sum, item) => sum + item.amountMinor, 0),
  };
  const value = values[metric] ?? null;
  const label = metric === "result" && value !== null ? value >= 0 ? "Ganancia del mes" : "Pérdida del mes" : meta.label;
  return { ...base, label, value: value === null ? null : round2(value), note: period };
}

function inferLayout(input: SlideInput | SlideChanges): SlideLayout {
  if (input.chart) return "chart";
  if (input.metrics?.length) return "kpis";
  if (input.left || input.right) return "comparison";
  return "bullets";
}

/** Builds a stored slide from a request, computing its chart and figures. */
export function buildSlide(input: SlideInput, deck: Pick<Deck, "month">, sources: DeckSources, id = newSlideId()): Slide {
  const title = input.title?.trim();
  if (!title) throw new DeckError("Cada diapositiva necesita un título.");
  const layout = input.layout ?? inferLayout(input);
  const month = input.month ?? deck.month;
  if (!isMonth(month)) throw new DeckError(`El mes "${month}" no es válido; usa AAAA-MM.`);
  const slide: Slide = { id, layout, title: title.slice(0, LIMITS.title) };
  const subtitle = clip(input.subtitle, LIMITS.subtitle); if (subtitle) slide.subtitle = subtitle;
  const text = clip(input.text, LIMITS.text); if (text) slide.text = text;
  const bullets = cleanList(input.bullets, LIMITS.bullets, LIMITS.bullet); if (bullets?.length) slide.bullets = bullets;
  const notes = clip(input.notes, LIMITS.notes); if (notes) slide.notes = notes;
  for (const side of ["left", "right"] as const) {
    const column = input[side];
    if (column) slide[side] = { title: column.title.trim().slice(0, 80), bullets: cleanList(column.bullets, LIMITS.columnBullets, LIMITS.bullet) ?? [] };
  }
  if (layout === "chart" && !input.chart) throw new DeckError("Una diapositiva de gráfico necesita elegir cuál (chart).", CHART_KIND_KEYS);
  if (layout === "kpis" && !input.metrics?.length) throw new DeckError("Una diapositiva de cifras necesita al menos una cifra (metrics).", METRIC_KEYS);
  if (layout === "comparison" && !slide.left && !slide.right) throw new DeckError("Una comparación necesita sus dos columnas (left y right).");
  if (input.chart) {
    const productId = resolveProduct(sources, input.product, Boolean(CHART_KINDS[input.chart].needsProduct));
    slide.chart = buildChart(input.chart, productId, month, sources);
  }
  if (input.metrics?.length) {
    const needsProduct = input.metrics.some((metric) => METRICS[metric].perProduct);
    const productId = resolveProduct(sources, input.product, needsProduct);
    slide.kpis = [...new Set(input.metrics)].slice(0, LIMITS.metrics).map((metric) => buildKpi(metric, productId, month, sources));
  }
  return slide;
}

/** The request a stored slide came from, so a change can rebuild it with fresh data. */
export function slideToInput(slide: Slide, sources: DeckSources): SlideInput {
  const productId = slide.chart?.productId ?? slide.kpis?.find((kpi) => kpi.productId)?.productId ?? null;
  return {
    layout: slide.layout, title: slide.title, subtitle: slide.subtitle, text: slide.text, bullets: slide.bullets, left: slide.left, right: slide.right, notes: slide.notes,
    chart: slide.chart?.kind, metrics: slide.kpis?.map((kpi) => kpi.metric),
    product: productId && sources.state.products.some((item) => item.id === productId) ? productId : undefined,
    month: slide.chart?.month ?? slide.kpis?.find((kpi) => kpi.month)?.month ?? undefined,
  };
}


/** Months and history each operation needs, so the server loads only that. */
export function dataNeeds(deck: Deck | null, operations: (DeckOperation | { slides: SlideInput[]; month: string })[]): { months: string[]; history: boolean } {
  const months = new Set<string>();
  let history = false;
  const addSlide = (input: SlideInput | SlideChanges, fallback: string) => {
    const month = input.month ?? fallback;
    if (isMonth(month)) months.add(month);
    if (input.chart && CHART_KINDS[input.chart].usesHistory) history = true;
  };
  const addStored = (slide: Slide, fallback: string) => {
    const month = slide.chart?.month ?? slide.kpis?.find((kpi) => kpi.month)?.month ?? fallback;
    if (isMonth(month)) months.add(month);
    if (slide.chart && CHART_KINDS[slide.chart.kind].usesHistory) history = true;
  };
  let deckMonth = deck?.month ?? "";
  if (isMonth(deckMonth)) months.add(deckMonth);
  for (const operation of operations) {
    if ("slides" in operation) { if (isMonth(operation.month)) { months.add(operation.month); deckMonth = operation.month; } operation.slides.forEach((slide) => addSlide(slide, deckMonth)); continue; }
    if (operation.action === "add") addSlide(operation.slide, deckMonth);
    if (operation.action === "update") {
      addSlide(operation.set, deckMonth);
      const stored = deck?.slides[operation.slide - 1];
      if (stored) addStored(stored, deckMonth);
    }
    if (operation.action === "settings" && operation.month && isMonth(operation.month)) { months.add(operation.month); deckMonth = operation.month; deck?.slides.forEach((slide) => addStored(slide, deckMonth)); }
    if (operation.action === "refresh") deck?.slides.forEach((slide) => addStored(slide, deckMonth));
  }
  return { months: [...months], history };
}

/**
 * Applies edits in order and returns the new deck with one readable line per change. Invalid edits throw a
 * DeckError that names the problem, so nothing half-applied is ever stored.
 *
 * Every number in one call (slide, position, to) refers to the deck as it was before the call, the way a person
 * reads it: "remove 2 and 7, add one before 9" works without counting how earlier changes shifted the rest.
 */
export function applyOperations(deck: Deck, meta: DeckMeta, operations: DeckOperation[], sources: DeckSources): { deck: Deck; meta: DeckMeta; done: string[] } {
  let next: Deck = { ...deck, slides: [...deck.slides] };
  const nextMeta = { ...meta };
  const done: string[] = [];
  const original = deck.slides.map((slide) => slide.id);
  const idOf = (number: number) => {
    if (!Number.isInteger(number) || number < 1 || number > original.length) throw new DeckError(`No existe la diapositiva ${number}; la presentación tiene ${original.length}.`);
    return original[number - 1];
  };
  const slideIndex = (number: number) => {
    const index = next.slides.findIndex((slide) => slide.id === idOf(number));
    if (index < 0) throw new DeckError(`La diapositiva ${number} ya se quitó en este mismo cambio.`);
    return index;
  };
  /** Where original slide `number` sits now; if it was removed in this call, where it used to be. */
  const anchor = (number: number) => {
    const clamped = Math.min(Math.max(1, Math.round(number)), original.length);
    const index = next.slides.findIndex((slide) => slide.id === original[clamped - 1]);
    return index >= 0 ? index : Math.min(clamped - 1, next.slides.length);
  };
  for (const operation of operations) {
    switch (operation.action) {
      case "add": {
        if (next.slides.length >= MAX_SLIDES) throw new DeckError(`Una presentación puede tener hasta ${MAX_SLIDES} diapositivas.`);
        const slide = buildSlide(operation.slide, next, sources);
        // "position 5" means where slide 5 is now: the new one goes right before it; past the end, it goes last.
        const index = operation.position === undefined || operation.position > original.length ? next.slides.length : anchor(operation.position);
        next.slides.splice(index, 0, slide);
        done.push(`Diapositiva agregada: «${slide.title}»`);
        break;
      }
      case "update": {
        const index = slideIndex(operation.slide);
        const current = next.slides[index];
        const base = slideToInput(current, sources);
        const set = operation.set;
        const merged: SlideInput = { ...base };
        for (const key of ["layout", "title", "subtitle", "text", "bullets", "left", "right", "product", "month", "notes"] as const) {
          if (set[key] !== undefined) (merged as Record<string, unknown>)[key] = set[key] === "" ? undefined : set[key];
        }
        if (set.chart !== undefined) merged.chart = set.chart ?? undefined;
        if (set.metrics !== undefined) merged.metrics = set.metrics?.length ? set.metrics : undefined;
        // Changing the content without naming a layout keeps the slide coherent (a new chart makes it a chart slide).
        if (set.layout === undefined && (set.chart !== undefined || set.metrics !== undefined) && !["cover", "section", "closing"].includes(current.layout)) merged.layout = inferLayout(merged);
        next.slides[index] = buildSlide(merged, next, sources, current.id);
        done.push(`Diapositiva ${operation.slide} actualizada: «${next.slides[index].title}»`);
        break;
      }
      case "remove": {
        const index = slideIndex(operation.slide);
        if (next.slides.length === 1) throw new DeckError("La presentación necesita al menos una diapositiva.");
        const [removed] = next.slides.splice(index, 1);
        done.push(`Diapositiva ${operation.slide} quitada: «${removed.title}»`);
        break;
      }
      case "move": {
        const index = slideIndex(operation.slide);
        const [slide] = next.slides.splice(index, 1);
        // Moving down lands after the target slide, moving up lands before it: "move 2 to 5" ends where 5 was.
        const target = anchor(operation.to);
        next.slides.splice(operation.to > operation.slide ? Math.min(target + 1, next.slides.length) : target, 0, slide);
        done.push(`«${slide.title}» movida`);
        break;
      }
      case "duplicate": {
        const index = slideIndex(operation.slide);
        if (next.slides.length >= MAX_SLIDES) throw new DeckError(`Una presentación puede tener hasta ${MAX_SLIDES} diapositivas.`);
        const copy = { ...structuredClone(next.slides[index]), id: newSlideId() };
        next.slides.splice(index + 1, 0, copy);
        done.push(`Diapositiva ${operation.slide} duplicada`);
        break;
      }
      case "settings": {
        if (operation.title?.trim()) { nextMeta.title = operation.title.trim().slice(0, LIMITS.title); done.push(`Título: «${nextMeta.title}»`); }
        if (operation.subtitle !== undefined) { next.subtitle = operation.subtitle.trim().slice(0, LIMITS.subtitle); done.push("Subtítulo actualizado"); }
        if (operation.theme) { if (!isDeckTheme(operation.theme)) throw new DeckError("Ese estilo no existe.", DECK_THEME_KEYS); nextMeta.theme = operation.theme; done.push(`Estilo: ${DECK_THEMES[operation.theme].label}`); }
        if (operation.month && operation.month !== next.month) {
          if (!isMonth(operation.month)) throw new DeckError(`El mes "${operation.month}" no es válido; usa AAAA-MM.`);
          const previous = next.month;
          next.month = operation.month;
          // Slides that followed the deck's month move with it.
          next.slides = next.slides.map((slide) => {
            const own = slide.chart?.month ?? slide.kpis?.find((kpi) => kpi.month)?.month ?? null;
            if (own !== previous) return slide;
            return buildSlide({ ...slideToInput(slide, sources), month: operation.month }, next, sources, slide.id);
          });
          done.push(`Período: ${monthLabel(operation.month)}`);
        }
        break;
      }
      case "refresh": {
        next.slides = next.slides.map((slide) => slide.chart || slide.kpis ? buildSlide(slideToInput(slide, sources), next, sources, slide.id) : slide);
        done.push("Cifras y gráficos actualizados con los datos de hoy");
        break;
      }
    }
  }
  next = { ...next, currency: sources.state.organization.currency, organization: sources.state.organization.name || next.organization, dataAt: sources.now };
  return { deck: next, meta: nextMeta, done };
}

/** A template's slides in words ("portada, cifras (…), ventas por canal, …"), for Cozte to know what each one brings. */
export function templateOutline(template: DeckTemplate): string {
  const stub = { state: { products: [{ id: "top", name: "el producto que más cuesta" }], organization: { name: "" } }, costs: [] } as unknown as DeckSources;
  return templateSlides(template, "2026-01", stub).map((slide) => slide.chart ? CHART_KINDS[slide.chart].label.toLowerCase()
    : slide.metrics ? `cifras (${slide.metrics.map((metric) => METRICS[metric].label.toLowerCase()).join(", ")})`
    : SLIDE_LAYOUTS[slide.layout ?? "bullets"].label.toLowerCase()).join(", ");
}

/** A deck's starting structure for a topic, adapted to the data the business has. */
export function templateSlides(template: DeckTemplate, month: string, sources: DeckSources): SlideInput[] {
  const products = sources.state.products;
  const byCost = [...products].sort((a, b) => (sources.costs.find((cost) => cost.productId === b.id)?.unitMinor ?? 0) - (sources.costs.find((cost) => cost.productId === a.id)?.unitMinor ?? 0));
  // The cover already shows the business and the month; its subtitle says what the deck answers.
  const cover = (title: string): SlideInput => ({ layout: "cover", title, subtitle: DECK_TEMPLATES[template].hint });
  switch (template) {
    case "ventas": return [
      cover("Informe de ventas"),
      { layout: "kpis", title: "El mes en cifras", metrics: ["revenue", "sales-count", "average-ticket", "units-sold"] },
      { title: "¿Por dónde se vendió?", chart: "sales-by-channel" },
      { title: "¿Qué se vendió?", chart: "sales-by-product" },
      { title: "¿Cuándo se vendió?", chart: "sales-by-day" },
      { title: "¿Cuánto deja cada canal?", chart: "channels" },
      { layout: "closing", title: "En resumen" },
    ];
    case "costos": return [
      cover("Costos de producción"),
      { title: "¿Cuánto cuesta hacer cada producto?", chart: "unit-cost" },
      ...byCost.slice(0, 2).map((product): SlideInput => ({ title: `¿En qué se va el costo de ${product.name}?`, chart: "cost-breakdown", product: product.id })),
      { title: "¿Cuánto deja cada producto?", chart: "margins" },
      { title: "¿Cómo cambió el costo?", chart: "cost-evolution" },
      { title: "La estructura del taller y la empresa", chart: "expenses-by-area" },
      { layout: "closing", title: "En resumen" },
    ];
    case "produccion": return [
      cover("Producción del mes"),
      { layout: "kpis", title: "La producción en cifras", metrics: ["products", "monthly-units"] },
      { title: "¿Cuánto se produce de cada producto?", chart: "production" },
      { title: "¿Cuánto cuesta producir cada unidad?", chart: "unit-cost" },
      ...byCost.slice(0, 1).map((product): SlideInput => ({ title: `¿En qué se va el costo de ${product.name}?`, chart: "cost-breakdown", product: product.id })),
      { layout: "closing", title: "En resumen" },
    ];
    case "entregas": return [
      cover("Entregas y canales"),
      { layout: "kpis", title: "Las entregas en cifras", metrics: ["deliveries", "delivery-cost", "sales-count"] },
      { title: "¿Cómo llegaron los pedidos?", chart: "deliveries" },
      { title: "¿Cuánto queda después de entregar?", chart: "channels" },
      { layout: "closing", title: "En resumen" },
    ];
    case "resultado": return [
      cover("Resultado del mes"),
      { layout: "kpis", title: "El mes en cifras", metrics: ["revenue", "contribution", "fixed-costs", "result"] },
      { title: "De las ventas al resultado", chart: "month-result" },
      { title: "¿Cuánto hay que vender para no perder?", chart: "break-even" },
      { title: "La estructura que hay que cubrir cada mes", chart: "expenses-by-area" },
      { layout: "closing", title: "Lo que enseña este mes" },
    ];
  }
}

/** Closing slides without their own points summarize the deck: each chart's conclusion, or the month's lessons. */
export function fillClosing(deck: Deck, sources: DeckSources, lessons: boolean): Deck {
  const insights = deck.slides.flatMap((slide) => slide.chart?.insight ? [slide.chart.insight] : []);
  const result = sources.views[deck.month]?.result;
  const taught = lessons && result ? monthLessons(result, (value) => formatMoney(value, deck.currency)).map((lesson) => `${lesson.title}: ${lesson.text}`) : [];
  const points = (taught.length ? taught : insights).slice(0, 4);
  return { ...deck, slides: deck.slides.map((slide) => slide.layout === "closing" && !slide.bullets?.length && points.length ? { ...slide, bullets: points.map((point) => point.slice(0, LIMITS.bullet)) } : slide) };
}

export function newDeck(input: { subtitle?: string; month: string; slides: SlideInput[] }, sources: DeckSources, template?: DeckTemplate): Deck {
  if (!isMonth(input.month)) throw new DeckError(`El mes "${input.month}" no es válido; usa AAAA-MM.`);
  if (!input.slides.length) throw new DeckError("La presentación necesita al menos una diapositiva.");
  if (input.slides.length > MAX_SLIDES) throw new DeckError(`Una presentación puede tener hasta ${MAX_SLIDES} diapositivas.`);
  const deck: Deck = {
    subtitle: input.subtitle?.trim().slice(0, LIMITS.subtitle) ?? "", month: input.month, currency: sources.state.organization.currency,
    organization: sources.state.organization.name ?? "", dataAt: sources.now, slides: [],
  };
  deck.slides = input.slides.map((slide) => buildSlide(slide, deck, sources));
  return fillClosing(deck, sources, template === "resultado");
}

function chartRows(data: ChartData, currency: string): { rows?: string[] } {
  if (data.type === "bars") return { rows: data.rows.slice(0, 6).map((row) => `${row.label}: ${formatValue(row.value, data.unit, currency)}`) };
  if (data.type === "stacked") return { rows: data.rows.slice(0, 6).map((row) => `${row.label}: ${formatMoney(row.total, currency)}`) };
  if (data.type === "waterfall") return { rows: data.steps.map((step) => `${step.label}: ${formatMoney(step.value, currency)}`) };
  if (data.type === "progress") return { rows: [`${data.valueLabel}: ${formatMoney(data.value, currency)}`, `${data.targetLabel}: ${formatMoney(data.target, currency)}`] };
  return {};
}

const MONEY_IN_TEXT = /(?:\$|\b(?:ARS|CLP|USD|MXN|COP|PEN|UYU|BOB|PYG|EUR)\s?)\s?(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(\s?(?:k|mil|M|millones?))?/giu;

function moneyValue(digits: string, suffix: string | undefined): number {
  const plain = /^\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?$/.test(digits) ? digits.replace(/[.\s]/g, "").replace(",", ".") : digits.replace(",", ".");
  const value = Number(plain);
  const unit = suffix?.trim().toLowerCase();
  return unit === "k" || unit === "mil" ? value * 1000 : unit === "m" || unit?.startsWith("millon") ? value * 1_000_000 : value;
}

/** Every amount the deck's charts and figures show, which texts may quote. */
function deckAmounts(deck: Deck): number[] {
  const values: number[] = [];
  for (const slide of deck.slides) {
    for (const kpi of slide.kpis ?? []) if (kpi.value !== null) values.push(kpi.value, Math.abs(kpi.value));
    const data = slide.chart?.data;
    if (!data) continue;
    if (data.type === "bars") values.push(...data.rows.map((row) => row.value), ...(data.total ? [data.total] : []));
    if (data.type === "stacked") values.push(...data.rows.flatMap((row) => [row.total, ...Object.values(row.parts)]));
    if (data.type === "columns") values.push(...data.rows.map((row) => row.value));
    if (data.type === "waterfall") values.push(...data.steps.map((step) => Math.abs(step.value)));
    if (data.type === "progress") values.push(data.value, data.target, Math.abs(data.target - data.value));
    if (data.type === "line") values.push(...data.series.flatMap((series) => series.values.filter((value): value is number => value !== null)));
    for (const text of [slide.chart?.insight, slide.chart?.caption]) for (const match of (text ?? "").matchAll(MONEY_IN_TEXT)) values.push(moneyValue(match[1], match[2]));
  }
  return values;
}

/**
 * Every amount the engine can show for the deck's month (all charts and figures, for every product), so a text may
 * quote a true figure even when the deck does not chart it.
 */
export function engineAmounts(sources: DeckSources, month: string): number[] {
  const products: (string | null)[] = [null, ...sources.state.products.map((product) => product.id)];
  const slides: Slide[] = [];
  const safe = (work: () => void) => { try { work(); } catch { /* A month or product without data adds nothing. */ } };
  for (const kind of CHART_KIND_KEYS) for (const productId of CHART_KINDS[kind].needsProduct || kind === "channels" ? products.slice(1) : [null]) safe(() => slides.push({ id: kind, layout: "chart", title: kind, chart: buildChart(kind, productId, month, sources) }));
  const kpis: Kpi[] = [];
  for (const metric of METRIC_KEYS) for (const productId of METRICS[metric].perProduct ? products.slice(1) : [null]) safe(() => kpis.push(buildKpi(metric, productId, month, sources)));
  const result = sources.views[month]?.result;
  const extra = result ? [result.fixedTotal, result.investmentsShare, result.oneOffTotal, result.variableProductionCost, result.purchasedMaterials, ...(result.breakEvenRevenue !== null ? [result.breakEvenRevenue - result.revenue] : [])] : [];
  return [...deckAmounts({ subtitle: "", month, currency: "", organization: "", dataAt: "", slides: [...slides, { id: "kpis", layout: "kpis", title: "kpis", kpis }] }), ...extra];
}

/**
 * Amounts written in slide texts (titles, conclusions, points, notes) that no chart or figure of the deck (or,
 * when given, of the engine) shows, give or take rounding. Cozte sees them as a warning so a made-up number never stays in a deck unnoticed.
 */
export function unbackedAmounts(deck: Deck, extra: number[] = []): string[] {
  const known = [...deckAmounts(deck), ...extra];
  const close = (value: number) => known.some((item) => Math.abs(Math.abs(item) - value) <= Math.max(1, Math.abs(item) * 0.01));
  const found = new Set<string>();
  for (const slide of deck.slides) {
    const texts = [slide.title, slide.subtitle, slide.text, slide.notes, ...(slide.bullets ?? []), ...[slide.left, slide.right].flatMap((column) => column ? [column.title, ...column.bullets] : [])];
    for (const text of texts) for (const match of (text ?? "").matchAll(MONEY_IN_TEXT)) {
      const value = moneyValue(match[1], match[2]);
      if (value >= 100 && !close(value)) found.add(match[0].trim());
    }
  }
  return [...found].slice(0, 8);
}

/** What Cozte reads back: each slide by number with its figures, so it can talk about them and edit precisely. */
export function deckOutline(deck: Deck) {
  const value = (kpi: Kpi) => formatValue(kpi.value, kpi.format, deck.currency);
  return deck.slides.map((slide, index) => ({
    number: index + 1,
    layout: SLIDE_LAYOUTS[slide.layout].label,
    title: slide.title,
    ...(slide.subtitle ? { subtitle: slide.subtitle } : {}),
    ...(slide.text ? { text: slide.text } : {}),
    ...(slide.bullets?.length ? { bullets: slide.bullets } : {}),
    ...(slide.left || slide.right ? { columns: [slide.left, slide.right].filter(Boolean) } : {}),
    ...(slide.chart ? { chart: { kind: slide.chart.kind, title: slide.chart.title, conclusion: slide.chart.insight, ...(slide.chart.caption ? { caption: slide.chart.caption } : {}), ...(slide.chart.data.type === "empty" ? { sinDatos: slide.chart.data.message } : {}), ...chartRows(slide.chart.data, deck.currency) } } : {}),
    ...(slide.kpis?.length ? { figures: slide.kpis.map((kpi) => `${kpi.label}${kpi.note ? ` (${kpi.note})` : ""}: ${value(kpi)}`) } : {}),
    ...(slide.notes ? { hasNotes: true } : {}),
  }));
}

/** Reads a stored deck defensively. */
export function parseDeck(value: unknown): Deck | null {
  let data = value;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return null; } }
  if (!data || typeof data !== "object") return null;
  const deck = data as Partial<Deck>;
  if (!Array.isArray(deck.slides) || typeof deck.month !== "string") return null;
  return { subtitle: deck.subtitle ?? "", month: deck.month, currency: deck.currency ?? "CLP", organization: deck.organization ?? "", dataAt: deck.dataAt ?? "", slides: deck.slides.filter((slide) => slide && typeof slide.title === "string" && typeof slide.layout === "string" && slide.layout in SLIDE_LAYOUTS) };
}
