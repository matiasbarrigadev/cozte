import "server-only";
import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { supportedCurrencies, type Currency } from "@/lib/currency";
import { calculateCosts, type DomainState } from "@/lib/domain";
import { buildCostOverview, buildProductDetail, evaluateExpression, normalizeName, resolveEntity, simulateScenario, standardUnitRatio } from "@/lib/cozte-cost-view";
import type { CozteToolName } from "@/lib/cozte-tool-catalog";
import { isoDateToolInputSchema } from "@/lib/iso-date";
import { ApiError, type Principal } from "./auth";
import { dbQuery } from "./db";
import { loadState } from "./state";
import { addAssistantToolEvent, errorDetails } from "./assistant-trace";
import { commitMutation, mutationSchema } from "./mutations";
import { createMutationProposal } from "./assistant-proposals";
import { archiveCozteNote, loadCozteNotes, saveCozteNote } from "./cozte-notes";
import { AREA_LABELS, PURCHASE_KIND_LABELS, channelEconomics } from "@/lib/business";
import { archiveRecord, loadBusinessView, loadChannels, recordPurchase, recordSale, saveChannel } from "./business";
import { resolveDocument } from "./documents";
import { WIDGETS, WIDGET_KINDS, boardOutline, computeWidget, moveWidget, widgetFigures, widgetTitle, type WidgetKind, type WidgetSpec } from "@/lib/cozte-widgets";
import { METRIC_KEYS, type MetricKey } from "@/lib/decks";
import { addToBoard, loadCozteSettings, saveBoard, saveExplanationLevel } from "./cozte-settings";
import { DECK_TEMPLATES, DeckError, deckOutline, monthLabel, templateOutline, type Presentation } from "@/lib/decks";
import { createDeckSchema, deckOperationSchema } from "@/lib/deck-schemas";
import { createPresentation, listPresentations, loadDeckSources, resolvePresentation, setPresentationSharing, undoPresentation, updatePresentation } from "./presentations";

type ToolStepInput = { principal: Principal; runId: string; toolCallId: string; toolName: CozteToolName; input: unknown };
type ToolResult = Record<string, unknown>;

const reference = z.string().trim().min(1).max(160);
const amount = z.number().nonnegative().max(1_000_000_000);
const currency = z.enum(supportedCurrencies);
const area = z.enum(["production", "delivery", "sales", "admin"]);
const receipt = z.string().trim().min(1).max(200);

export const cozteToolInputSchemas = {
  readCosts: z.object({
    product: reference.optional().describe("Nombre o ID de un producto para ver su desglose completo (insumos, trabajo, gastos compartidos, márgenes). Omítelo para ver toda la empresa."),
  }),
  calculate: z.object({
    expression: z.string().trim().min(1).max(400).describe("Operación con números simples, sin separador de miles y con punto decimal. Ej: (1600000 / 23) / 112"),
    label: z.string().trim().max(120).optional().describe("Qué representa el resultado, en palabras"),
  }),
  simulate: z.object({
    materialPrices: z.array(z.object({ material: reference, price: amount.describe("Precio por unidad de compra en la moneda de la empresa") })).max(40).optional(),
    expenseAmounts: z.array(z.object({ expense: reference, monthlyAmount: amount })).max(40).optional(),
    products: z.array(z.object({
      product: reference,
      goodUnitsPerLot: z.number().int().positive().optional(),
      lotsPerMonth: z.number().positive().optional(),
      hoursPerLot: z.number().nonnegative().optional(),
      directLaborPerLot: amount.optional(),
      salePrice: amount.optional(),
    })).max(30).optional(),
    recipe: z.array(z.object({ product: reference, material: reference, quantityPerLot: z.number().nonnegative().describe("En unidades de compra del insumo") })).max(60).optional(),
  }),
  saveProduct: z.object({
    product: reference.optional().describe("Nombre o ID de un producto existente para modificarlo. Omítelo para crear uno nuevo."),
    name: z.string().trim().min(2).max(120).optional().describe("Nombre del producto nuevo, o el nuevo nombre si lo renombras"),
    goodUnitsPerLot: z.number().int().positive().max(1_000_000_000).optional().describe("Unidades buenas y vendibles que salen de un lote o tanda (ya descontada la merma normal). Obligatorio al crear."),
    lotsPerMonth: z.number().positive().max(1_000_000).nullable().optional().describe("Lotes que se producen en un mes normal. Reparte los gastos del mes; null si se desconoce."),
    hoursPerLot: z.number().nonnegative().max(1_000_000).optional().describe("Horas de trabajo que toma un lote; se usa para repartir gastos por horas"),
    directLaborPerLot: amount.optional().describe("Pago de mano de obra directa atribuible a un lote. Si los sueldos se pagan por mes, regístralos como gasto mensual y deja esto en 0."),
    salePrice: amount.nullable().optional().describe("Precio de venta por unidad; null o 0 si aún no está definido. No afecta el costo de fabricar."),
    salesVariablePerUnit: amount.optional().describe("Gasto de venta por unidad (comisión, envío); 0 si no aplica o no se conoce"),
  }),
  saveMaterial: z.object({
    material: reference.optional().describe("Nombre o ID de un insumo existente para modificarlo. Omítelo para crear uno nuevo."),
    name: z.string().trim().min(2).max(120).optional().describe("Nombre del insumo nuevo, o el nuevo nombre si lo renombras"),
    purchaseUnit: z.string().trim().min(1).max(60).optional().describe("Unidad en que se compra y se paga el precio: kg, litro, unidad, m2, caja de 100… Obligatoria al crear."),
    price: amount.optional().describe("Precio por UNA unidad de compra"),
    currency: currency.optional().describe("Moneda del precio; por defecto la de la empresa"),
    priceSource: z.string().trim().min(2).max(160).optional().describe("De dónde sale el precio: factura, cotización, estimación de la persona…"),
    priceDate: isoDateToolInputSchema.optional().describe("Fecha del precio (AAAA-MM-DD); por defecto hoy"),
    supplier: z.string().trim().max(120).optional(),
    category: z.string().trim().min(2).max(40).optional(),
  }),
  saveRecipe: z.object({
    product: reference.describe("Nombre o ID del producto"),
    items: z.array(z.object({
      material: reference.describe("Nombre o ID del insumo (debe existir; créalo antes si hace falta)"),
      perUnit: z.number().nonnegative().max(1_000_000_000).optional().describe("Cantidad que consume UNA unidad terminada (ej. 'cada tofu lleva 0.21 kg de soja' → 0.21). Usa perUnit o perLot, no ambos."),
      perLot: z.number().nonnegative().max(1_000_000_000).optional().describe("Cantidad que consume el lote o tanda COMPLETA (ej. 'por tanda usamos 20 kg de soja' → 20). Usa perUnit o perLot, no ambos."),
      unit: z.string().trim().min(1).max(60).optional().describe("Unidad de esa cantidad si difiere de la unidad de compra (ej. g cuando se compra por kg)"),
      usageUnitsPerPurchaseUnit: z.number().positive().max(1_000_000_000).optional().describe("Solo para unidades no estándar: cuántas unidades de uso trae una unidad de compra (ej. 1 caja = 100 etiquetas → 100)"),
    }).refine((item) => (item.perUnit === undefined) !== (item.perLot === undefined), "Indica perUnit o perLot (uno solo); 0 quita el insumo de la receta")).min(1).max(40),
    replaceAll: z.boolean().optional().describe("true quita de la receta los insumos que no estén en la lista"),
  }),
  saveExpense: z.object({
    expense: reference.optional().describe("Nombre o ID de un gasto existente para modificarlo. Omítelo para crear uno nuevo."),
    name: z.string().trim().min(2).max(120).optional(),
    amount: amount.optional().describe("Importe pagado por período indicado en frequency"),
    frequency: z.enum(["monthly", "quarterly", "annual", "weekly"]).optional().describe("Cada cuánto se paga ese importe; se guarda su equivalente mensual. Por defecto monthly."),
    currency: currency.optional(),
    area: area.optional().describe("Área del gasto: production (el taller; se reparte en el costo de cada producto), delivery (entregas), sales (ventas) o admin (administración). Por defecto production."),
    splitBy: z.enum(["hours", "units", "percentages"]).optional().describe("Solo para gastos de producción, cómo se reparte entre productos: hours = horas de producción del mes; units = unidades buenas del mes; percentages = porcentajes acordados. Obligatorio al crear uno de producción."),
    percentages: z.array(z.object({ product: reference, percent: z.number().min(0).max(100) })).max(30).optional().describe("Solo con splitBy percentages; deben sumar 100"),
    category: z.string().trim().min(2).max(40).optional(),
    source: z.string().trim().min(2).max(160).optional().describe("De dónde sale el importe"),
  }),
  saveCategory: z.object({
    name: z.string().trim().min(2).max(40),
    renameFrom: z.string().trim().min(2).max(40).optional().describe("Categoría existente que pasa a llamarse name"),
  }),
  removeItem: z.object({
    kind: z.enum(["product", "material"]),
    item: reference,
    reason: z.string().trim().min(3).max(300),
  }),
  saveNote: z.object({
    text: z.string().trim().min(5).max(500).optional().describe("Hecho o decisión confirmada por la persona que conviene recordar en próximas conversaciones"),
    replacesNoteId: z.string().max(80).optional().describe("ID de una nota vigente que este texto reemplaza"),
    removeNoteId: z.string().max(80).optional().describe("ID de una nota que ya no es válida"),
  }),
  saveChannel: z.object({
    channel: reference.optional().describe("Nombre o ID de un canal existente para modificarlo. Omítelo para crear uno."),
    name: z.string().trim().min(2).max(80).optional(),
    delivery: z.string().trim().max(80).optional().describe("Cómo llega al cliente: retiro, delivery propio, correo, lo entrega la plataforma…"),
    commissionPercent: z.number().min(0).max(100).optional().describe("Parte del precio que se queda el canal: comisión, tarjeta, plataforma"),
    feePerSale: amount.optional().describe("Cargo fijo por cada venta o pedido"),
    deliveryCostPerOrder: amount.optional().describe("Lo que le cuesta a la empresa entregar un pedido por este canal"),
    unitsPerOrder: z.number().positive().max(1_000_000).optional().describe("Unidades promedio por pedido; reparte los cargos por pedido entre las unidades"),
    priceAdjustmentPercent: z.number().min(-90).max(100).optional().describe("Precio del canal frente al de lista: -25 = 25 % menos (mayorista)"),
  }),
  recordPurchase: z.object({
    date: isoDateToolInputSchema.optional().describe("Fecha del comprobante (AAAA-MM-DD); por defecto hoy"),
    description: z.string().trim().min(2).max(200).describe("Qué se compró, en palabras simples"),
    supplier: z.string().trim().max(120).optional(),
    total: z.number().nonnegative().max(1_000_000_000_000).describe("Total pagado"),
    currency: currency.optional(),
    kind: z.enum(["material", "expense", "fixed_payment", "investment"]).describe("material: insumo de una receta; expense: se usa y se termina en el mes; fixed_payment: pago de un gasto mensual ya cargado; investment: dura más de un año"),
    area: area.optional().describe("production, delivery, sales o admin. Un insumo es production; un pago de gasto fijo toma el área de ese gasto."),
    material: reference.optional().describe("Solo para material: nombre o ID del insumo (créalo antes con saveMaterial si no existe)"),
    quantity: z.number().positive().max(1_000_000_000).optional().describe("Solo para material: cuántas unidades de compra se compraron; con eso se actualiza su precio"),
    expense: reference.optional().describe("Solo para fixed_payment: nombre o ID del gasto mensual que se pagó"),
    usefulLifeMonths: z.number().int().min(1).max(600).optional().describe("Solo para investment: meses que se va a usar"),
    includeInUnitCost: z.boolean().optional().describe("Solo para una inversión del taller (area production), según lo que decida la persona: true suma su parte mensual al costo de cada producto; false la deja solo en el resultado del mes"),
    splitBy: z.enum(["hours", "units"]).optional().describe("Si includeInUnitCost: cómo repartirla entre productos (horas de producción o unidades); por defecto horas"),
    receipt: receipt.optional().describe("Comprobante: número del archivo adjunto en el mensaje (1, 2…) o su nombre"),
  }),
  setInvestmentCost: z.object({
    investment: reference.describe("Nombre o ID de una inversión del taller ya registrada"),
    includeInUnitCost: z.boolean().describe("La decisión de la persona: true suma su parte mensual al costo de cada producto; false la deja solo en el resultado del mes"),
    splitBy: z.enum(["hours", "units"]).optional().describe("Cómo repartirla entre productos: horas de producción o unidades; por defecto horas"),
  }),
  recordSale: z.object({
    date: isoDateToolInputSchema.optional().describe("Fecha de la venta (AAAA-MM-DD); por defecto hoy"),
    channel: reference.optional().describe("Canal de venta; si se omite, venta directa"),
    items: z.array(z.object({
      product: reference,
      quantity: z.number().positive().max(1_000_000_000),
      unitPrice: amount.optional().describe("Precio por unidad cobrado; si se omite, el de lista con el ajuste del canal"),
    })).min(1).max(40),
    deliveryCost: amount.optional().describe("Lo que costó entregar este pedido, si no es el habitual del canal"),
    customer: z.string().trim().max(120).optional(),
    note: z.string().trim().max(300).optional(),
    receipt: receipt.optional().describe("Remito o factura: número del archivo adjunto en el mensaje (1, 2…) o su nombre"),
  }),
  voidRecord: z.object({
    kind: z.enum(["purchase", "sale"]),
    id: z.string().min(1).max(120).describe("ID de la compra o venta (de un registro de este turno o de readBusiness)"),
    reason: z.string().trim().min(3).max(300),
  }),
  readBusiness: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("Mes AAAA-MM; por defecto el actual"),
  }),
  showVisual: z.object({
    visual: z.enum(WIDGET_KINDS as [WidgetKind, ...WidgetKind[]]).describe(`Qué widget mostrar. ${WIDGET_KINDS.map((kind) => `${kind}: ${WIDGETS[kind].hint}`).join("; ")}`),
    product: reference.optional().describe("Producto (nombre o ID): obligatorio en cost-breakdown si hay varios; opcional en channels y en kpis con cifras por producto"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("Mes fijo AAAA-MM. Omítelo para que muestre siempre el mes en curso (se actualiza solo)"),
    metrics: z.array(z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]])).min(1).max(4).optional().describe("Solo para kpis: las cifras a mostrar"),
    title: z.string().trim().min(2).max(60).optional().describe("Título corto a medida si ayuda (ej. 'Cómo va la feria'); si no, se usa el nombre del widget"),
    pin: z.boolean().optional().describe("true además lo fija en el tablero junto al chat, cuando la persona quiere seguir viéndolo"),
  }),
  manageBoard: z.object({
    action: z.enum(["list", "remove", "move", "rename", "clear"]).describe("list: ver el tablero; remove: quitar un widget; move: cambiarlo de lugar; rename: cambiarle el título; clear: vaciar el tablero"),
    widget: z.number().int().min(1).max(12).optional().describe("Número del widget en el tablero (1 = arriba), para remove, move y rename"),
    to: z.number().int().min(1).max(12).optional().describe("Para move: el lugar nuevo (1 = arriba)"),
    title: z.string().trim().min(2).max(60).optional().describe("Para rename: el título nuevo"),
  }),
  setExplanationLevel: z.object({
    level: z.enum(["simple", "medium", "advanced"]).describe("simple: nueva en esto; medium: quiere mejorar; advanced: nivel técnico"),
  }),
  createPresentation: createDeckSchema.extend({
    title: z.string().trim().min(1).max(140).describe("Título de la presentación (también va en la portada)"),
  }),
  editPresentation: z.object({
    presentation: reference.optional().describe("Título o ID de la presentación; por defecto la última editada"),
    changes: z.array(deckOperationSchema).max(20).optional().describe("Cambios en orden. Los números de diapositiva son los de readPresentation o del último resultado, y se renumeran después de agregar, quitar o mover"),
    undo: z.boolean().optional().describe("true vuelve a la versión anterior al último cambio (no lo combines con changes)"),
  }),
  readPresentation: z.object({
    presentation: reference.optional().describe("Título o ID para ver sus diapositivas; omítelo para listar las presentaciones"),
  }),
  sharePresentation: z.object({
    presentation: reference.optional().describe("Título o ID; por defecto la última editada"),
    public: z.boolean().describe("true crea el link público (o devuelve el que ya existe); false lo desactiva y deja de funcionar"),
  }),
  askQuestions: z.object({
    intro: z.string().trim().max(300).optional().describe("Una frase que explica para qué necesitas estas respuestas"),
    questions: z.array(z.object({
      question: z.string().trim().min(3).max(240),
      options: z.array(z.string().trim().min(1).max(120)).min(2).max(5).describe("Respuestas probables y concretas, en el lenguaje de la persona. Siempre puede escribir otra respuesta, así que no agregues 'Otro'."),
      multiple: z.boolean().optional().describe("true si puede elegir varias opciones a la vez"),
    })).min(1).max(4),
  }),
} satisfies Record<CozteToolName, z.ZodType>;

const COZTE_TOOL_DESCRIPTIONS: Record<CozteToolName, string> = {
  readCosts: "Lee el estado guardado ahora mismo: productos, recetas, insumos con precio y fuente, gastos mensuales, costos calculados por el motor (con supuestos y datos faltantes), notas y la lista de datos que más mejorarían la estimación. Con product devuelve el desglose completo de ese producto.",
  calculate: "Calculadora exacta. Úsala para toda cuenta que vayas a mostrar o guardar (conversiones, promedios, equivalencias). No hagas aritmética de memoria.",
  simulate: "Calcula con el motor un escenario hipotético (precios, gastos, volumen, receta, precio de venta) y compara contra el costo actual. No guarda nada.",
  saveProduct: "Crea o modifica un producto. Solo exige nombre y unidades buenas por lote; el resto puede completarse después. Devuelve el costo recalculado.",
  saveMaterial: "Crea o modifica un insumo y su precio vigente por unidad de compra. Devuelve el impacto en los productos que lo usan.",
  saveRecipe: "Define cuánto de cada insumo consume un producto, por lote o por unidad, convirtiendo unidades estándar (g↔kg, ml↔l, cm↔m). Varios insumos en una sola llamada.",
  saveExpense: "Crea o modifica un gasto compartido del taller (sueldos, luz, gas, alquiler…), lo lleva a equivalente mensual y define cómo se reparte entre productos.",
  saveCategory: "Crea o renombra una categoría de costos.",
  removeItem: "Pide dar de baja un producto o insumo. No se aplica sola: queda pendiente para que la persona la confirme en pantalla.",
  saveNote: "Guarda, reemplaza o quita un hecho o decisión de la empresa para recordarlo en próximas conversaciones (ej. 'los sueldos se reparten por horas', 'el fundador no cobra sueldo fijo').",
  saveChannel: "Crea o modifica un canal de venta (local, feria, Instagram, Mercado Libre, mayorista…) con su comisión, cargo por venta, costo de entrega por pedido y ajuste de precio. Devuelve cuánto queda por unidad de cada producto en ese canal.",
  recordPurchase: "Registra una compra del día a día con su tipo y área, y le adjunta el comprobante. Un insumo con cantidad actualiza su precio; una inversión se reparte en su vida útil.",
  recordSale: "Registra una venta: productos, cantidades y canal, con su remito o factura. Calcula lo cobrado, lo que cuesta vender y entregar, y lo que dejó.",
  setInvestmentCost: "Guarda la decisión de la persona sobre una inversión del taller: si su parte mensual se suma al costo de cada producto o queda solo en el resultado del mes. Devuelve el costo antes y después.",
  voidRecord: "Anula una compra o venta mal registrada (queda en el historial). Después puedes registrarla bien.",
  readBusiness: "Lee cómo va un mes: canales y lo que queda por unidad en cada uno, gastos fijos por área e inversiones, compras, ventas, resultado del mes y punto de equilibrio.",
  showVisual: "Muestra en el chat un widget con datos reales del motor (costos, márgenes, producción, ventas por canal/producto/día, entregas, canales, resultado del mes, punto de equilibrio, gastos por área, evolución, compras o cifras clave a elección). Devuelve sus cifras y su conclusión. Con pin: true lo fija en el tablero de la persona, donde se actualiza solo.",
  manageBoard: "Ordena el tablero de la persona: lo lista, quita, mueve o renombra un widget, o lo vacía. Para agregar usa showVisual con pin: true.",
  setExplanationLevel: "Guarda cómo prefiere la persona que le expliques: simple, medio o avanzado.",
  createPresentation: `Crea una presentación de diapositivas con los datos reales del negocio y la guarda. Parte de una plantilla o de diapositivas a medida. Cada plantilla ya trae: ${(Object.keys(DECK_TEMPLATES) as (keyof typeof DECK_TEMPLATES)[]).map((key) => `${key} = ${templateOutline(key)}`).join("; ")}. Con plantilla, slides agrega diapositivas NUEVAS antes del cierre: no repitas las que ya trae; para cambiar sus títulos o textos usa después editPresentation con update. Los gráficos y cifras los calcula el motor: tú eliges cuáles y escribes títulos, conclusiones y puntos. La persona la ve en el chat y puede presentarla, editarla o compartirla.`,
  editPresentation: "Modifica una presentación guardada: agrega, cambia, quita, mueve o duplica diapositivas; cambia título, estilo o mes; recalcula los datos; o deshace el último cambio. Todos los números de diapositiva de una llamada se refieren a la presentación como estaba ANTES de la llamada (como la ves en el último resultado): puedes quitar 2 y 7 y agregar antes de la 9 en una sola llamada. Cada cambio queda en el historial y se puede deshacer.",
  readPresentation: "Lista las presentaciones guardadas o muestra las diapositivas de una (número, diseño, título, textos, gráfico con su conclusión y cifras).",
  sharePresentation: "Crea o desactiva el link público de una presentación: cualquiera con el link la ve sin cuenta, sin las notas de quien presenta ni otros datos de la empresa.",
  askQuestions: "Muestra a la persona de 1 a 4 preguntas con opciones para elegir; siempre puede responder con texto libre. Úsala cuando necesites datos o decisiones que solo ella conoce. Termina tu turno: las respuestas llegan en su próximo mensaje, así que no escribas nada después de llamarla.",
};

function stableKey(...parts: (string | number)[]): string {
  const bytes = createHash("sha256").update(parts.join(":")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const today = () => new Date().toISOString().slice(0, 10);
const whole = (value: number) => Math.round(value);
const threeDecimals = (value: number) => Math.round(value * 1000) / 1000;

function expectedFxRates(state: DomainState): Record<string, number> {
  return Object.fromEntries([...new Set([...state.materials, ...state.expenses].map((item) => item.currency ?? state.organization.currency))]
    .filter((code) => code !== state.organization.currency)
    .flatMap((code) => state.fxQuotes?.[code] ? [[code, state.fxQuotes[code]!.ratePpm]] : []));
}

function notFound(kind: string, ref: string, candidates: string[]): ToolResult {
  return { ok: false, error: `No identifiqué ${kind} "${ref}" sin ambigüedad.`, options: candidates, next: "Pregunta a la persona cuál es, o usa uno de los nombres listados." };
}

/** Creation deduplicates only on the same name; a partial match must never redirect a create into an update. */
const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);

type Draft = Record<string, unknown>;
type Plan = { description: string; build: (state: DomainState) => Draft | null };

const MAX_CONFLICT_RETRIES = 8;

/**
 * Applies mutations one at a time against the latest state. Each one is rebuilt from intent
 * after a revision conflict, so parallel tool calls in the same turn do not fail each other.
 */
async function commitPlans(input: ToolStepInput, plans: Plan[]) {
  const done: string[] = [];
  const entityIds: string[] = [];
  for (const [index, plan] of plans.entries()) {
    const idempotencyKey = stableKey(input.runId, input.toolCallId, index);
    for (let attempt = 0; ; attempt++) {
      const state = await loadState(input.principal);
      const draft = plan.build(state);
      if (!draft) break;
      const parsed = mutationSchema.safeParse({ ...draft, expectedRevision: state.revision, idempotencyKey, acknowledgeImpact: true });
      if (!parsed.success) throw new Error(`${plan.description}: ${parsed.error.issues[0]?.message ?? "datos inválidos"}`);
      try {
        const result = await commitMutation(input.principal, parsed.data, { source: "cozte" });
        done.push(plan.description);
        entityIds.push(result.entityId);
        break;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409 || attempt >= MAX_CONFLICT_RETRIES) throw error;
        const applied = await dbQuery("SELECT 1 AS found FROM change_sets WHERE organization_id=? AND idempotency_key=?", [input.principal.organizationId, idempotencyKey]);
        if (applied.length) { done.push(plan.description); break; }
        // Jitter spreads out sibling tool calls that raced for the same revision.
        await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1) + Math.random() * 120));
      }
    }
  }
  return { done, entityIds };
}

async function costReceipt(principal: Principal, productIds?: string[]) {
  const state = await loadState(principal);
  const costs = calculateCosts(state);
  const wanted = productIds ? new Set(productIds) : null;
  return state.products.filter((product) => !wanted || wanted.has(product.id)).map((product) => {
    const cost = costs.find((item) => item.productId === product.id);
    return {
      product: product.name, id: product.id, status: cost?.quality ?? "incomplete",
      unitCost: cost?.unitMinor ?? null, knownUnitCostSoFar: cost?.unitMinor == null && (cost?.partialUnitMinor ?? 0) > 0 ? cost?.partialUnitMinor : undefined,
      missing: cost?.warnings ?? [], assumptions: cost?.assumptions ?? [],
    };
  });
}

function productsUsing(state: DomainState, materialId: string) {
  return state.components.filter((item) => item.materialId === materialId).map((item) => item.productId);
}

async function runCozteTool(input: ToolStepInput): Promise<ToolResult> {
  const { principal } = input;
  const schema = cozteToolInputSchemas[input.toolName];
  const args = schema.parse(input.input) as Record<string, unknown>;
  switch (input.toolName) {
    case "readCosts": {
      const { product } = args as z.infer<typeof cozteToolInputSchemas.readCosts>;
      const state = await loadState(principal);
      const costs = calculateCosts(state);
      if (product) {
        const found = resolveEntity(state.products, product);
        if (!found.item) return notFound("el producto", product, found.candidates);
        return { ok: true, readAt: new Date().toISOString(), currency: state.organization.currency, ...buildProductDetail(state, found.item.id, costs) };
      }
      const notes = await loadCozteNotes(principal).catch(() => []);
      return { ok: true, readAt: new Date().toISOString(), ...buildCostOverview(state, costs), notes: notes.map((note) => ({ id: note.id, text: note.text })) };
    }
    case "calculate": {
      const { expression, label } = args as z.infer<typeof cozteToolInputSchemas.calculate>;
      try { return { ok: true, label: label ?? null, expression, result: evaluateExpression(expression) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Expresión inválida" }; }
    }
    case "simulate": {
      const state = await loadState(principal);
      return { ok: true, currency: state.organization.currency, ...simulateScenario(state, args as z.infer<typeof cozteToolInputSchemas.simulate>) };
    }
    case "saveProduct": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveProduct>;
      const state = await loadState(principal);
      const target = value.product ? resolveEntity(state.products, value.product) : value.name ? { item: state.products.find((item) => sameName(item.name, value.name!)) ?? null, candidates: [] } : null;
      if (value.product && !target?.item) return notFound("el producto", value.product, target && "candidates" in target ? target.candidates : []);
      const existing = target?.item ?? null;
      const batches = (lots: number | null | undefined, fallback: number | null | undefined) => lots === undefined ? fallback ?? null : lots === null ? null : Math.max(1, Math.round(lots * 1000));
      if (!existing) {
        const missing = [!value.name && "nombre del producto", value.goodUnitsPerLot === undefined && "unidades buenas por lote"].filter(Boolean) as string[];
        if (missing.length) return { ok: false, error: "Faltan datos para crear el producto.", needs: missing };
        const { done, entityIds } = await commitPlans(input, [{ description: `Producto ${value.name} creado`, build: () => ({
          action: "create-product", name: value.name, lotUnits: value.goodUnitsPerLot,
          salePriceMinor: whole(value.salePrice ?? 0), salesVariableMinor: whole(value.salesVariablePerUnit ?? 0), laborLotMinor: whole(value.directLaborPerLot ?? 0),
          productionHoursMilli: Math.round((value.hoursPerLot ?? 0) * 1000), batchesPerMonthMilli: batches(value.lotsPerMonth, null),
        }) }]);
        return { ok: true, done, ids: { product: entityIds[0] }, costs: await costReceipt(principal, entityIds) };
      }
      const productId = existing.id;
      const { done } = await commitPlans(input, [{ description: `Producto ${value.name ?? existing.name} actualizado`, build: (latest) => {
        const current = latest.products.find((item) => item.id === productId);
        if (!current) throw new Error("El producto ya no existe");
        return {
          action: "update-product", id: productId, name: value.name ?? current.name, lotUnits: value.goodUnitsPerLot ?? current.lotUnits,
          salePriceMinor: value.salePrice === undefined ? current.salePriceMinor : whole(value.salePrice ?? 0),
          salesVariableMinor: value.salesVariablePerUnit === undefined ? current.salesVariableMinor : whole(value.salesVariablePerUnit),
          laborLotMinor: value.directLaborPerLot === undefined ? current.laborLotMinor : whole(value.directLaborPerLot),
          productionHoursMilli: value.hoursPerLot === undefined ? current.productionHoursMilli : Math.round(value.hoursPerLot * 1000),
          batchesPerMonthMilli: batches(value.lotsPerMonth, current.batchesPerMonthMilli),
        };
      } }]);
      return { ok: true, done, ids: { product: productId }, costs: await costReceipt(principal) };
    }
    case "saveMaterial": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveMaterial>;
      const state = await loadState(principal);
      const found = value.material ? resolveEntity(state.materials, value.material) : null;
      if (value.material && !found?.item) return notFound("el insumo", value.material, found && "candidates" in found ? found.candidates : []);
      const existing = found?.item ?? (value.name ? state.materials.find((item) => sameName(item.name, value.name!)) ?? null : null);
      const priceCurrency: Currency = value.currency ?? existing?.currency ?? state.organization.currency;
      if (!existing) {
        const missing = [!value.name && "nombre del insumo", !value.purchaseUnit && "unidad de compra"].filter(Boolean) as string[];
        if (missing.length) return { ok: false, error: "Faltan datos para crear el insumo.", needs: missing };
        const { done, entityIds } = await commitPlans(input, [{ description: `Insumo ${value.name} creado${value.price !== undefined ? ` a ${value.price} ${priceCurrency} por ${value.purchaseUnit}` : " sin precio"}`, build: () => ({
          action: "create-material", name: value.name, supplier: value.supplier ?? "", purchaseUnit: value.purchaseUnit, category: value.category,
          ...(value.price !== undefined ? { price: threeDecimals(value.price), currency: priceCurrency, source: value.priceSource ?? "Informado a Cozte", effectiveDate: value.priceDate ?? today() } : {}),
        }) }]);
        return { ok: true, done, ids: { material: entityIds[0] }, next: "Si ya se sabe en qué productos se usa, guarda su consumo en la receta." };
      }
      const materialId = existing.id;
      const plans: Plan[] = [];
      for (const field of ["name", "supplier", "purchaseUnit", "category"] as const) {
        const next = value[field];
        if (next === undefined || next === existing[field]) continue;
        plans.push({ description: `${field === "name" ? "Nombre" : field === "supplier" ? "Proveedor" : field === "purchaseUnit" ? "Unidad de compra" : "Categoría"} de ${existing.name} actualizado a ${next}`, build: () => ({ action: "update-material-meta", id: materialId, field, value: next }) });
      }
      if (value.price !== undefined) {
        plans.push({ description: `Precio de ${value.name ?? existing.name} actualizado a ${value.price} ${priceCurrency} por ${value.purchaseUnit ?? existing.purchaseUnit}`, build: (latest) => ({
          action: "bulk-prices", materials: [{ id: materialId, amount: threeDecimals(value.price!), currency: priceCurrency }], expenses: [],
          expectedFxRates: expectedFxRates(latest), source: value.priceSource ?? "Informado a Cozte", effectiveDate: value.priceDate ?? today(),
        }) });
      }
      if (!plans.length) return { ok: true, done: [], unchanged: true, note: "Ya estaba así; no hubo cambios." };
      const before = await costReceipt(principal, productsUsing(state, materialId));
      const { done } = await commitPlans(input, plans);
      const after = await costReceipt(principal, productsUsing(state, materialId));
      return { ok: true, done, ids: { material: materialId }, impact: after.map((item) => ({ ...item, unitCostBefore: before.find((old) => old.id === item.id)?.unitCost ?? null })) };
    }
    case "saveRecipe": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveRecipe>;
      const state = await loadState(principal);
      const product = resolveEntity(state.products, value.product);
      if (!product.item) return notFound("el producto", value.product, product.candidates);
      const productItem = product.item;
      // Every saved line is echoed per unit and per lot, with its cost, so a unit/lot mix-up is visible in the receipt.
      const converted: { materialId: string; quantityMilli: number; line: Record<string, unknown> }[] = [];
      const problems: string[] = [];
      for (const item of value.items) {
        const material = resolveEntity(state.materials, item.material);
        if (!material.item) { problems.push(`Insumo "${item.material}" no identificado (opciones: ${material.candidates.join(", ")})`); continue; }
        const quantity = item.perUnit ?? item.perLot ?? 0;
        const perLot = item.perUnit !== undefined ? quantity * productItem.lotUnits : quantity;
        const usageUnit = item.unit ?? material.item.purchaseUnit;
        const ratio = item.usageUnitsPerPurchaseUnit ? 1 / item.usageUnitsPerPurchaseUnit : standardUnitRatio(usageUnit, material.item.purchaseUnit);
        if (ratio === null) { problems.push(`Para ${material.item.name}: ¿cuántos ${usageUnit} trae un ${material.item.purchaseUnit}? (usa usageUnitsPerPurchaseUnit)`); continue; }
        const purchaseUnitsPerLot = perLot * ratio;
        const quantityMilli = Math.round(purchaseUnitsPerLot * 1000);
        if (quantity > 0 && quantityMilli === 0) { problems.push(`La cantidad de ${material.item.name} por lote es menor a una milésima de ${material.item.purchaseUnit}; conviene registrar el insumo con una unidad de compra más chica`); continue; }
        const unitsPerProduct = purchaseUnitsPerLot / Math.max(productItem.lotUnits, 1);
        converted.push({ materialId: material.item.id, quantityMilli, line: {
          material: material.item.name,
          informed: `${quantity} ${usageUnit} por ${item.perUnit !== undefined ? "unidad" : "lote"}`,
          perUnit: `${Math.round(unitsPerProduct * 100000) / 100000} ${material.item.purchaseUnit}`,
          perLot: `${threeDecimals(purchaseUnitsPerLot)} ${material.item.purchaseUnit} (lote de ${productItem.lotUnits})`,
          costPerUnit: material.item.priceMinor === null ? null : Math.round(material.item.priceMinor * unitsPerProduct * 100) / 100,
        } });
      }
      if (problems.length) return { ok: false, error: "No guardé la receta porque hay datos por aclarar.", needs: problems, ready: converted.map((item) => item.line) };
      const listed = new Set(converted.map((item) => item.materialId));
      const removals = value.replaceAll ? state.components.filter((item) => item.productId === productItem.id && !listed.has(item.materialId)).map((item) => ({ materialId: item.materialId, quantityMilli: 0 })) : [];
      const items = [...converted.map(({ materialId, quantityMilli }) => ({ materialId, quantityMilli })), ...removals];
      const before = await costReceipt(principal, [productItem.id]);
      const { done } = await commitPlans(input, [{ description: `Receta de ${productItem.name} guardada`, build: () => ({ action: "set-components", productId: productItem.id, items }) }]);
      const after = await costReceipt(principal, [productItem.id]);
      return { ok: true, done, saved: converted.map((item) => item.line), removed: removals.length, costBefore: before[0]?.unitCost ?? null, costs: after, check: "Confirma que 'informed' coincide con lo que dijo la persona (por unidad o por lote)." };
    }
    case "saveExpense": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveExpense>;
      const state = await loadState(principal);
      const active = state.expenses.filter((item) => item.period === state.activePeriod);
      const found = value.expense ? resolveEntity(active, value.expense) : null;
      if (value.expense && !found?.item) return notFound("el gasto", value.expense, found && "candidates" in found ? found.candidates : []);
      const existing = found?.item ?? (value.name ? active.find((item) => sameName(item.name, value.name!)) ?? null : null);
      const factor = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12, weekly: 52 / 12 }[value.frequency ?? "monthly"];
      const monthly = value.amount === undefined ? undefined : threeDecimals(value.amount * factor);
      const expenseCurrency: Currency = value.currency ?? existing?.currency ?? state.organization.currency;
      let shares: Record<string, number> = {};
      if (value.splitBy === "percentages") {
        const entries: { id: string; percent: number }[] = [];
        for (const share of value.percentages ?? []) {
          const product = resolveEntity(state.products, share.product);
          if (!product.item) return notFound("el producto", share.product, product.candidates);
          entries.push({ id: product.item.id, percent: share.percent });
        }
        const total = entries.reduce((sum, item) => sum + item.percent, 0);
        if (!entries.length || Math.abs(total - 100) > 0.5) return { ok: false, error: `Los porcentajes suman ${total}; deben sumar 100 entre los productos.`, needs: ["porcentajes por producto que sumen 100"] };
        shares = Object.fromEntries(entries.map((item) => [item.id, Math.round(item.percent * 100)]));
        const drift = 10000 - Object.values(shares).reduce((sum, item) => sum + item, 0);
        if (drift) shares[entries.sort((a, b) => b.percent - a.percent)[0].id] += drift;
      }
      const expenseArea = value.area ?? existing?.area ?? "production";
      const basis = expenseArea !== "production" ? (existing ? undefined : "units") : value.splitBy === "percentages" ? "manual" : value.splitBy;
      const frequencyNote = value.frequency && value.frequency !== "monthly" && value.amount !== undefined ? ` (${value.amount} ${value.frequency === "annual" ? "al año" : value.frequency === "quarterly" ? "por trimestre" : "por semana"} = ${monthly} al mes)` : "";
      if (!existing) {
        const missing = [!value.name && "nombre del gasto", value.amount === undefined && "importe", expenseArea === "production" && !value.splitBy && "cómo repartirlo entre productos (horas, unidades o porcentajes)"].filter(Boolean) as string[];
        if (missing.length) return { ok: false, error: "Faltan datos para crear el gasto.", needs: missing };
        const { done } = await commitPlans(input, [{ description: `Gasto ${value.name} creado: ${monthly} ${expenseCurrency} al mes${frequencyNote}${expenseArea !== "production" ? ` (${AREA_LABELS[expenseArea]})` : ""}`, build: (latest) => ({
          action: "create-expense", name: value.name, period: latest.activePeriod, amount: monthly, currency: expenseCurrency,
          allocationBasis: basis, shares, category: value.category, source: value.source ?? "Informado a Cozte", area: expenseArea,
        }) }]);
        return { ok: true, done, costs: await costReceipt(principal) };
      }
      const expenseId = existing.id;
      const plans: Plan[] = [];
      if (monthly !== undefined) plans.push({ description: `Gasto ${existing.name} actualizado a ${monthly} ${expenseCurrency} al mes${frequencyNote}`, build: (latest) => ({
        action: "bulk-prices", materials: [], expenses: [{ id: expenseId, amount: monthly, currency: expenseCurrency }],
        expectedFxRates: expectedFxRates(latest), source: value.source ?? "Informado a Cozte", effectiveDate: today(),
      }) });
      if (basis) plans.push({ description: `Reparto de ${existing.name} por ${value.splitBy === "hours" ? "horas" : value.splitBy === "units" ? "unidades" : "porcentajes"}`, build: () => ({ action: "update-expense-allocation", id: expenseId, basis, shares }) });
      if (value.area && value.area !== (existing.area ?? "production")) plans.push({ description: `${existing.name} pasa al área ${AREA_LABELS[value.area]}`, build: () => ({ action: "update-expense-meta", id: expenseId, field: "area", value: value.area }) });
      if (value.name && value.name !== existing.name) plans.push({ description: `Gasto renombrado a ${value.name}`, build: () => ({ action: "update-expense-meta", id: expenseId, field: "name", value: value.name }) });
      if (value.category && value.category !== existing.category) plans.push({ description: `Categoría de ${existing.name}: ${value.category}`, build: () => ({ action: "update-expense-meta", id: expenseId, field: "category", value: value.category }) });
      if (!plans.length) return { ok: true, done: [], unchanged: true, note: "Ya estaba así; no hubo cambios." };
      const { done } = await commitPlans(input, plans);
      return { ok: true, done, costs: await costReceipt(principal) };
    }
    case "saveCategory": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveCategory>;
      const state = await loadState(principal);
      const categories = state.categories ?? [];
      if (value.renameFrom) {
        const found = resolveEntity(categories, value.renameFrom);
        if (!found.item) return notFound("la categoría", value.renameFrom, found.candidates);
        const categoryId = found.item.id;
        const { done } = await commitPlans(input, [{ description: `Categoría ${found.item.name} renombrada a ${value.name}`, build: () => ({ action: "rename-category", id: categoryId, name: value.name }) }]);
        return { ok: true, done };
      }
      if (categories.some((item) => sameName(item.name, value.name))) return { ok: true, done: [], unchanged: true, note: "La categoría ya existe." };
      const { done } = await commitPlans(input, [{ description: `Categoría ${value.name} creada`, build: () => ({ action: "create-category", name: value.name }) }]);
      return { ok: true, done };
    }
    case "removeItem": {
      const value = args as z.infer<typeof cozteToolInputSchemas.removeItem>;
      const state = await loadState(principal);
      const found = resolveEntity<{ id: string; name: string }>(value.kind === "product" ? state.products : state.materials, value.item);
      if (!found.item) return notFound(value.kind === "product" ? "el producto" : "el insumo", value.item, found.candidates);
      const proposal = await createMutationProposal(principal, { action: value.kind === "product" ? "delete-product" : "delete-material", id: found.item.id, expectedRevision: state.revision, idempotencyKey: stableKey(input.runId, input.toolCallId) }, { source: { runId: input.runId, toolCallId: input.toolCallId }, stateSnapshot: state, label: `Dar de baja ${found.item.name}`, brief: value.reason });
      return { ok: true, pendingReview: true, done: [], proposal: { title: proposal.title, status: proposal.status }, note: "La baja no se aplicó: la persona debe confirmarla en pantalla." };
    }
    case "saveNote": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveNote>;
      if (value.removeNoteId && !value.text) {
        const removed = await archiveCozteNote(principal, value.removeNoteId);
        return removed ? { ok: true, done: ["Nota quitada"] } : { ok: false, error: "No encontré esa nota vigente." };
      }
      if (!value.text) return { ok: false, error: "Falta el texto de la nota." };
      const saved = await saveCozteNote(principal, value.text, value.replacesNoteId ?? value.removeNoteId);
      return { ok: true, done: [saved.replaced ? "Nota actualizada" : "Nota guardada"], ids: { note: saved.id } };
    }
    case "saveChannel": {
      const value = args as z.infer<typeof cozteToolInputSchemas.saveChannel>;
      const channels = await loadChannels(principal);
      const found = value.channel ? resolveEntity(channels, value.channel) : null;
      if (value.channel && !found?.item) return notFound("el canal", value.channel, found && "candidates" in found ? found.candidates : []);
      const existing = found?.item ?? (value.name ? channels.find((item) => sameName(item.name, value.name!)) ?? null : null);
      if (!existing && !value.name) return { ok: false, error: "Falta el nombre del canal.", needs: ["nombre del canal"] };
      const saved = await saveChannel(principal, {
        id: existing?.id, name: value.name ?? existing!.name, deliveryMethod: value.delivery ?? existing?.deliveryMethod ?? "",
        commissionPercent: value.commissionPercent ?? (existing ? existing.commissionBps / 100 : 0),
        feePerOrder: value.feePerSale ?? existing?.feePerOrderMinor ?? 0,
        deliveryCostPerOrder: value.deliveryCostPerOrder ?? existing?.deliveryCostPerOrderMinor ?? 0,
        unitsPerOrder: value.unitsPerOrder ?? (existing ? existing.unitsPerOrderMilli / 1000 : 1),
        priceAdjustmentPercent: value.priceAdjustmentPercent ?? (existing ? existing.priceAdjustmentBps / 100 : 0),
      });
      const state = await loadState(principal);
      const perUnit = channelEconomics(state, calculateCosts(state), [saved.channel]).map((row) => ({ product: row.productName, price: row.price, productionCost: row.productionCost, sellingCost: row.sellingCost, deliveryCost: row.deliveryCost, leftPerUnit: row.left, leftPercent: row.leftPercent }));
      return { ok: true, done: [`Canal ${saved.channel.name} ${saved.created ? "creado" : "actualizado"}`], ids: { channel: saved.id }, perUnit, note: "leftPerUnit es lo que queda por unidad después de producir, vender y entregar; todavía falta cubrir los gastos fijos de la empresa." };
    }
    case "recordPurchase": {
      const value = args as z.infer<typeof cozteToolInputSchemas.recordPurchase>;
      const state = await loadState(principal);
      const material = value.material ? resolveEntity(state.materials, value.material) : null;
      if (value.material && !material?.item) return notFound("el insumo", value.material, material && "candidates" in material ? material.candidates : []);
      const active = state.expenses.filter((item) => item.period === state.activePeriod);
      const expense = value.expense ? resolveEntity(active, value.expense) : null;
      if (value.expense && !expense?.item) return notFound("el gasto", value.expense, expense && "candidates" in expense ? expense.candidates : []);
      const needs = [
        value.kind === "material" && !material?.item && "qué insumo se compró (créalo antes con saveMaterial si no existe)",
        value.kind === "fixed_payment" && !expense?.item && "qué gasto mensual se pagó",
        value.kind === "investment" && !value.usefulLifeMonths && "cuántos meses se va a usar",
        (value.kind === "expense" || value.kind === "investment") && !value.area && "a qué área corresponde: producción, entregas, ventas o administración",
      ].filter(Boolean) as string[];
      if (needs.length) return { ok: false, error: "Faltan datos para registrar la compra.", needs };
      const document = value.receipt ? await resolveDocument(principal, value.receipt) : null;
      const recorded = await recordPurchase(principal, {
        purchasedOn: value.date ?? today(), description: value.description, supplier: value.supplier ?? "", amount: value.total, currency: value.currency,
        kind: value.kind, area: value.area, materialId: material?.item?.id, quantity: value.quantity, expenseId: expense?.item?.id,
        usefulLifeMonths: value.usefulLifeMonths, includeInUnitCost: value.includeInUnitCost, allocationBasis: value.splitBy, documentId: document?.id,
      }, { source: "cozte", idempotencyKey: stableKey(input.runId, input.toolCallId) });
      const purchase = recorded.purchase;
      const done = [
        `Compra registrada: ${purchase.description}, ${purchase.amountMinor} ${state.organization.currency} (${PURCHASE_KIND_LABELS[purchase.kind]}, ${AREA_LABELS[purchase.area]})`,
        ...(recorded.priceUpdated ? [`Precio de ${recorded.priceUpdated.material} actualizado a ${recorded.priceUpdated.unitPrice} ${recorded.priceUpdated.currency} por unidad de compra`] : []),
        ...(document ? [`Comprobante ${document.filename} adjuntado`] : []),
      ];
      return {
        ok: true, done, ids: { purchase: recorded.id },
        ...(purchase.kind === "investment" && purchase.usefulLifeMonths ? {
          monthlyShare: Math.round(purchase.amountMinor / purchase.usefulLifeMonths), includedInUnitCost: Boolean(purchase.includeInUnitCost),
          note: purchase.includeInUnitCost
            ? "Su parte mensual se suma al costo de cada producto y también cuenta en el resultado de cada mes durante su vida útil."
            : purchase.area === "production"
              ? "Por ahora su parte mensual cuenta solo en el resultado del mes, no en el costo por unidad. Si la persona no lo decidió, asesórala y guarda su decisión con setInvestmentCost."
              : "Una inversión no es un gasto del mes: el resultado de cada mes suma su parte (monthlyShare) durante su vida útil.",
          ...(purchase.includeInUnitCost ? { costs: await costReceipt(principal) } : {}),
        } : {}),
        ...(purchase.kind === "material" ? { note: "Los insumos no son un gasto del mes: se vuelven costo cuando se vende lo que se produce con ellos." } : {}),
        ...(value.receipt && !document ? { receiptWarning: "No encontré ese archivo; la compra quedó sin comprobante." } : {}),
        ...(recorded.priceUpdated && material?.item ? { costs: await costReceipt(principal, productsUsing(state, material.item.id)) } : {}),
      };
    }
    case "recordSale": {
      const value = args as z.infer<typeof cozteToolInputSchemas.recordSale>;
      const [state, channels] = await Promise.all([loadState(principal), loadChannels(principal)]);
      const channel = value.channel ? resolveEntity(channels, value.channel) : null;
      if (value.channel && !channel?.item) return { ...notFound("el canal", value.channel, channel && "candidates" in channel ? channel.candidates : []), next: "Usa uno de los canales listados o créalo con saveChannel." };
      const items: { productId: string; quantity: number; unitPrice?: number }[] = [];
      for (const item of value.items) {
        const product = resolveEntity(state.products, item.product);
        if (!product.item) return notFound("el producto", item.product, product.candidates);
        items.push({ productId: product.item.id, quantity: item.quantity, unitPrice: item.unitPrice });
      }
      const document = value.receipt ? await resolveDocument(principal, value.receipt) : null;
      const recorded = await recordSale(principal, {
        soldOn: value.date ?? today(), channelId: channel?.item?.id ?? null, items, deliveryCost: value.deliveryCost,
        customer: value.customer ?? "", note: value.note ?? "", documentId: document?.id,
      }, { source: "cozte", idempotencyKey: stableKey(input.runId, input.toolCallId) });
      const sale = recorded.sale;
      const left = sale.variableCostMinor === null ? null : sale.totalMinor - sale.variableCostMinor - sale.sellingCostMinor - sale.deliveryCostMinor;
      return {
        ok: true, ids: { sale: recorded.id },
        done: [`Venta registrada: ${sale.items.map((item) => `${item.quantityMilli / 1000} × ${item.productName}`).join(", ")} por ${sale.channelName}, total ${sale.totalMinor} ${state.organization.currency}`, ...(document ? [`Remito ${document.filename} adjuntado`] : [])],
        sale: { total: sale.totalMinor, sellingCost: sale.sellingCostMinor, deliveryCost: sale.deliveryCostMinor, materialsAndLaborOfItems: sale.variableCostMinor, leftAfterSaleCosts: left, items: sale.items.map((item) => ({ product: item.productName, quantity: item.quantityMilli / 1000, unitPrice: item.unitPriceMinor })) },
        note: "leftAfterSaleCosts = total − materialsAndLaborOfItems − sellingCost − deliveryCost: lo que dejó la venta para pagar los gastos fijos del mes (los del taller incluidos). El envío es por pedido: esta venta cuenta como un pedido.",
        ...(value.receipt && !document ? { receiptWarning: "No encontré ese archivo; la venta quedó sin remito." } : {}),
      };
    }
    case "setInvestmentCost": {
      const value = args as z.infer<typeof cozteToolInputSchemas.setInvestmentCost>;
      const state = await loadState(principal);
      const workshop = (state.investments ?? []).filter((item) => item.area === "production");
      const found = resolveEntity(workshop, value.investment);
      if (!found.item) return notFound("la inversión del taller", value.investment, found.candidates);
      const investment = found.item;
      if (investment.includeInUnitCost === value.includeInUnitCost && (!value.splitBy || value.splitBy === investment.allocationBasis)) return { ok: true, done: [], unchanged: true, note: "Ya estaba así; no hubo cambios." };
      const before = await costReceipt(principal);
      const { done } = await commitPlans(input, [{ description: value.includeInUnitCost ? `${investment.name}: su parte mensual se suma al costo de cada producto` : `${investment.name}: su parte mensual queda solo en el resultado del mes`, build: () => ({ action: "set-investment-cost", id: investment.id, include: value.includeInUnitCost, allocationBasis: value.splitBy }) }]);
      const after = await costReceipt(principal);
      return { ok: true, done, costs: after.map((item) => ({ ...item, unitCostBefore: before.find((old) => old.id === item.id)?.unitCost ?? null })) };
    }
    case "voidRecord": {
      const value = args as z.infer<typeof cozteToolInputSchemas.voidRecord>;
      await archiveRecord(principal, value.kind, value.id, value.reason);
      return { ok: true, done: [value.kind === "purchase" ? "Compra anulada" : "Venta anulada"] };
    }
    case "readBusiness": {
      const value = args as z.infer<typeof cozteToolInputSchemas.readBusiness>;
      const view = await loadBusinessView(principal, value.month ?? today().slice(0, 7));
      return {
        ok: true, readAt: new Date().toISOString(), currency: view.currency, month: view.month,
        channels: view.channels.map((channel) => ({ id: channel.id, name: channel.name, delivery: channel.deliveryMethod, commissionPercent: channel.commissionBps / 100, feePerSale: channel.feePerOrderMinor, deliveryCostPerOrder: channel.deliveryCostPerOrderMinor, unitsPerOrder: channel.unitsPerOrderMilli / 1000, priceAdjustmentPercent: channel.priceAdjustmentBps / 100 })),
        perUnitByChannel: view.economics.map((row) => ({ channel: row.channelName, product: row.productName, price: row.price, productionCost: row.productionCost, sellingCost: row.sellingCost, deliveryCost: row.deliveryCost, leftPerUnit: row.left })),
        fixedCostsByArea: view.structure.areas.map((item) => ({ area: item.label, monthlyTotal: item.monthlyTotal, expenses: item.expenses.map((expense) => ({ name: expense.name, monthlyAmount: expense.monthlyAmount })), investments: item.investments.map((asset) => ({ description: asset.description, monthlyShare: asset.monthlyShare, monthsLeft: asset.monthsLeft, ...(item.area === "production" ? { includedInUnitCost: asset.includeInUnitCost } : {}) })) })),
        result: view.result,
        purchases: view.purchases.slice(0, 40).map((purchase) => ({ id: purchase.id, date: purchase.purchasedOn, description: purchase.description, amount: purchase.amountMinor, kind: PURCHASE_KIND_LABELS[purchase.kind], area: AREA_LABELS[purchase.area], hasReceipt: Boolean(purchase.documentId) })),
        sales: view.sales.slice(0, 40).map((sale) => ({ id: sale.id, date: sale.soldOn, channel: sale.channelName, total: sale.totalMinor, items: sale.items.map((item) => `${item.quantityMilli / 1000} × ${item.productName}`).join(", "), hasReceipt: Boolean(sale.documentId) })),
      };
    }
    case "showVisual": {
      const value = args as z.infer<typeof cozteToolInputSchemas.showVisual>;
      const state = await loadState(principal);
      let productId: string | null = null;
      if (value.product) {
        const found = resolveEntity(state.products, value.product);
        if (!found.item) return notFound("el producto", value.product, found.candidates);
        productId = found.item.id;
      } else if (WIDGETS[value.visual].needsProduct) {
        if (state.products.length !== 1) return { ok: false, error: "Falta indicar de qué producto mostrar el desglose.", options: state.products.map((item) => item.name) };
        productId = state.products[0].id;
      }
      const widget: WidgetSpec = { kind: value.visual, productId, addedBy: "cozte", ...(value.month ? { month: value.month } : {}), ...(value.visual === "kpis" ? { metrics: value.metrics ?? ["revenue", "result", "sales-count", "break-even"] } : {}), ...(value.title ? { title: value.title } : {}) };
      const currentMonth = today().slice(0, 7);
      const sources = await loadDeckSources(principal, { months: [value.month ?? currentMonth], history: Boolean(WIDGETS[value.visual].usesHistory) });
      const content = computeWidget(widget, sources, currentMonth);
      const pinned = value.pin ? await addToBoard(principal, widget).then(() => true) : false;
      const title = widgetTitle(widget, state.products.find((item) => item.id === productId)?.name);
      return {
        ok: true, visual: value.visual, productId, product: state.products.find((item) => item.id === productId)?.name ?? null,
        month: value.month ?? null, metrics: widget.metrics ?? null, title: value.title ?? null, pinned,
        shows: title, figures: widgetFigures(content, state.organization.currency), conclusion: content.insight,
        ...(pinned ? { done: [`«${title}» fijado en el tablero`] } : {}),
        note: `La persona ve «${title}» con datos ${value.month ? "de ese mes" : "actuales"}${pinned ? " y quedó fijo en su tablero, donde se actualiza solo" : ""}. En el texto responde con el número clave y qué significa; no repitas toda la tabla.`,
      };
    }
    case "manageBoard": {
      const value = args as z.infer<typeof cozteToolInputSchemas.manageBoard>;
      const [{ board }, state] = await Promise.all([loadCozteSettings(principal), loadState(principal)]);
      const name = (id: string) => state.products.find((item) => item.id === id)?.name;
      const outline = (list: typeof board) => boardOutline(list, name);
      if (value.action === "list") return { ok: true, board: outline(board), note: board.length ? "Widgets de arriba hacia abajo." : "El tablero está vacío." };
      if (value.action === "clear") { await saveBoard(principal, []); return { ok: true, done: [board.length ? `Tablero vacío (se quitaron ${board.length} widgets)` : "El tablero ya estaba vacío"], board: [] }; }
      const index = (value.widget ?? 0) - 1;
      const target = board[index];
      if (!target) return { ok: false, error: value.widget ? `No hay un widget ${value.widget}; el tablero tiene ${board.length}.` : "Indica el número del widget (widget).", board: outline(board) };
      const title = widgetTitle(target, target.productId ? name(target.productId) : null);
      let next = board;
      let done = "";
      if (value.action === "remove") { next = board.filter((item) => item.id !== target.id); done = `«${title}» quitado del tablero`; }
      if (value.action === "move") {
        if (!value.to) return { ok: false, error: "Indica el lugar nuevo (to)." };
        next = moveWidget(board, target.id, value.to - 1); done = `«${title}» movido al lugar ${Math.min(value.to, board.length)}`;
      }
      if (value.action === "rename") {
        if (!value.title) return { ok: false, error: "Indica el título nuevo (title)." };
        next = board.map((item) => item.id === target.id ? { ...item, title: value.title } : item); done = `«${title}» ahora se llama «${value.title}»`;
      }
      const saved = await saveBoard(principal, next);
      return { ok: true, done: [done], board: outline(saved) };
    }
    case "setExplanationLevel": {
      const value = args as z.infer<typeof cozteToolInputSchemas.setExplanationLevel>;
      await saveExplanationLevel(principal, value.level);
      return { ok: true, done: [`Nivel de explicación: ${value.level === "simple" ? "simple" : value.level === "medium" ? "medio" : "avanzado"}`], note: "Desde el próximo mensaje explica con ese nivel." };
    }
    case "createPresentation": {
      const value = args as z.infer<typeof cozteToolInputSchemas.createPresentation>;
      const created = await createPresentation(principal, value);
      return deckReceipt(created, [`Presentación «${created.title}» creada con ${created.deck.slides.length} diapositivas`], created.warnings);
    }
    case "editPresentation": {
      const value = args as z.infer<typeof cozteToolInputSchemas.editPresentation>;
      if (!value.undo && !value.changes?.length) return { ok: false, error: "Indica los cambios (changes) o undo: true." };
      const target = await resolvePresentation(principal, value.presentation);
      const result = value.undo ? await undoPresentation(principal, target.id) : await updatePresentation(principal, target.id, value.changes!);
      return deckReceipt(result.presentation, result.done, "warnings" in result ? result.warnings as string[] : []);
    }
    case "readPresentation": {
      const value = args as z.infer<typeof cozteToolInputSchemas.readPresentation>;
      if (!value.presentation) {
        const list = await listPresentations(principal);
        if (list.length !== 1) return { ok: true, presentations: list.slice(0, 20).map((item) => ({ id: item.id, title: item.title, slides: item.slideCount, month: monthLabel(item.deck.month), shared: Boolean(item.shareUrl), updatedAt: item.updatedAt })), note: list.length ? "Pide una por título para ver sus diapositivas." : "Todavía no hay presentaciones." };
      }
      const found = await resolvePresentation(principal, value.presentation);
      return { ...deckReceipt(found, []), note: "Diapositivas actuales, numeradas desde 1." };
    }
    case "sharePresentation": {
      const value = args as z.infer<typeof cozteToolInputSchemas.sharePresentation>;
      const target = await resolvePresentation(principal, value.presentation);
      const shared = await setPresentationSharing(principal, target.id, value.public);
      return deckReceipt(shared, [shared.shareUrl ? `Link público de «${shared.title}»: ${shared.shareUrl}` : `Link público de «${shared.title}» desactivado`]);
    }
    case "askQuestions": {
      const value = args as z.infer<typeof cozteToolInputSchemas.askQuestions>;
      return { ok: true, asked: value.questions.length, waitingForAnswers: true };
    }
  }
}

/** What Cozte gets back from a presentation tool: the deck by numbered slides with its figures, and its links. */
function deckReceipt(presentation: Presentation, done: string[], warnings: string[] = []): ToolResult {
  return {
    ok: true, done, presentationId: presentation.id, revision: presentation.revision, title: presentation.title, theme: presentation.theme,
    month: monthLabel(presentation.deck.month), slideCount: presentation.deck.slides.length, publicUrl: presentation.shareUrl,
    slides: deckOutline(presentation.deck),
    ...(warnings.length ? { warning: `Estos montos de tus textos no salen del motor: ${warnings.join(", ")}. Corrígelos con editPresentation (update de esas diapositivas) sobre esta misma presentación; no crees otra.` } : {}),
    note: "La persona ve la presentación en el chat con botones para verla, editarla y copiar el link. En tu mensaje cuenta en pocas frases qué muestra y lo más importante (con las cifras de arriba), y ofrece ajustes; no repitas diapositiva por diapositiva.",
  };
}

async function executeCozteToolStep(input: ToolStepInput): Promise<ToolResult> {
  "use step";
  const startedAt = Date.now();
  const record = (kind: "tool_started" | "tool_finished", payload: unknown) => addAssistantToolEvent(input.runId, input.toolCallId, kind, payload);
  await record("tool_started", { toolCallId: input.toolCallId, toolName: input.toolName, input: input.input });
  let output: ToolResult;
  try {
    output = await runCozteTool(input);
  } catch (error) {
    // Every failure becomes a readable receipt: the model must see it failed and why, never a silent success.
    const message = error instanceof z.ZodError ? `Datos inválidos: ${error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`
      : error instanceof ApiError || error instanceof DeckError ? error.message
      : "Error interno al guardar; el cambio no se aplicó.";
    output = { ok: false, error: message, ...(error instanceof DeckError && error.options.length ? { options: error.options.slice(0, 20) } : {}), ...(error instanceof ApiError || error instanceof z.ZodError || error instanceof DeckError ? {} : { technicalDetail: errorDetails(error).slice(0, 240) }) };
    await record("tool_finished", { toolCallId: input.toolCallId, toolName: input.toolName, durationMs: Date.now() - startedAt, failed: true, output, error: errorDetails(error) });
    return output;
  }
  await record("tool_finished", { toolCallId: input.toolCallId, toolName: input.toolName, durationMs: Date.now() - startedAt, failed: output.ok === false, output });
  return output;
}

export function createCozteTools(principal: Principal, runId: string) {
  const execute = (toolName: CozteToolName) => (input: unknown, { toolCallId }: { toolCallId: string }) =>
    executeCozteToolStep({ principal, runId, toolCallId, toolName, input });
  const schemas = cozteToolInputSchemas;
  const describe = COZTE_TOOL_DESCRIPTIONS;
  return {
    readCosts: tool({ description: describe.readCosts, inputSchema: schemas.readCosts, execute: execute("readCosts") }),
    calculate: tool({ description: describe.calculate, inputSchema: schemas.calculate, execute: execute("calculate") }),
    simulate: tool({ description: describe.simulate, inputSchema: schemas.simulate, execute: execute("simulate") }),
    saveProduct: tool({ description: describe.saveProduct, inputSchema: schemas.saveProduct, execute: execute("saveProduct") }),
    saveMaterial: tool({ description: describe.saveMaterial, inputSchema: schemas.saveMaterial, execute: execute("saveMaterial") }),
    saveRecipe: tool({ description: describe.saveRecipe, inputSchema: schemas.saveRecipe, execute: execute("saveRecipe") }),
    saveExpense: tool({ description: describe.saveExpense, inputSchema: schemas.saveExpense, execute: execute("saveExpense") }),
    saveCategory: tool({ description: describe.saveCategory, inputSchema: schemas.saveCategory, execute: execute("saveCategory") }),
    removeItem: tool({ description: describe.removeItem, inputSchema: schemas.removeItem, execute: execute("removeItem") }),
    saveNote: tool({ description: describe.saveNote, inputSchema: schemas.saveNote, execute: execute("saveNote") }),
    saveChannel: tool({ description: describe.saveChannel, inputSchema: schemas.saveChannel, execute: execute("saveChannel") }),
    recordPurchase: tool({ description: describe.recordPurchase, inputSchema: schemas.recordPurchase, execute: execute("recordPurchase") }),
    recordSale: tool({ description: describe.recordSale, inputSchema: schemas.recordSale, execute: execute("recordSale") }),
    setInvestmentCost: tool({ description: describe.setInvestmentCost, inputSchema: schemas.setInvestmentCost, execute: execute("setInvestmentCost") }),
    voidRecord: tool({ description: describe.voidRecord, inputSchema: schemas.voidRecord, execute: execute("voidRecord") }),
    readBusiness: tool({ description: describe.readBusiness, inputSchema: schemas.readBusiness, execute: execute("readBusiness") }),
    showVisual: tool({ description: describe.showVisual, inputSchema: schemas.showVisual, execute: execute("showVisual") }),
    manageBoard: tool({ description: describe.manageBoard, inputSchema: schemas.manageBoard, execute: execute("manageBoard") }),
    setExplanationLevel: tool({ description: describe.setExplanationLevel, inputSchema: schemas.setExplanationLevel, execute: execute("setExplanationLevel") }),
    createPresentation: tool({ description: describe.createPresentation, inputSchema: schemas.createPresentation, execute: execute("createPresentation") }),
    editPresentation: tool({ description: describe.editPresentation, inputSchema: schemas.editPresentation, execute: execute("editPresentation") }),
    readPresentation: tool({ description: describe.readPresentation, inputSchema: schemas.readPresentation, execute: execute("readPresentation") }),
    sharePresentation: tool({ description: describe.sharePresentation, inputSchema: schemas.sharePresentation, execute: execute("sharePresentation") }),
    askQuestions: tool({ description: describe.askQuestions, inputSchema: schemas.askQuestions, execute: execute("askQuestions") }),
  };
}
