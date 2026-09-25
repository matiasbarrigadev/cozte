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

type ToolStepInput = { principal: Principal; runId: string; toolCallId: string; toolName: CozteToolName; input: unknown };
type ToolResult = Record<string, unknown>;

const reference = z.string().trim().min(1).max(160);
const amount = z.number().nonnegative().max(1_000_000_000);
const currency = z.enum(supportedCurrencies);

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
    splitBy: z.enum(["hours", "units", "percentages"]).optional().describe("Cómo se reparte entre productos: hours = horas de producción del mes; units = unidades buenas del mes; percentages = porcentajes acordados. Obligatorio al crear."),
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
      const basis = value.splitBy === "percentages" ? "manual" : value.splitBy;
      const frequencyNote = value.frequency && value.frequency !== "monthly" && value.amount !== undefined ? ` (${value.amount} ${value.frequency === "annual" ? "al año" : value.frequency === "quarterly" ? "por trimestre" : "por semana"} = ${monthly} al mes)` : "";
      if (!existing) {
        const missing = [!value.name && "nombre del gasto", value.amount === undefined && "importe", !value.splitBy && "cómo repartirlo entre productos (horas, unidades o porcentajes)"].filter(Boolean) as string[];
        if (missing.length) return { ok: false, error: "Faltan datos para crear el gasto.", needs: missing };
        const { done } = await commitPlans(input, [{ description: `Gasto ${value.name} creado: ${monthly} ${expenseCurrency} al mes${frequencyNote}`, build: (latest) => ({
          action: "create-expense", name: value.name, period: latest.activePeriod, amount: monthly, currency: expenseCurrency,
          allocationBasis: basis, shares, category: value.category, source: value.source ?? "Informado a Cozte",
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
    case "askQuestions": {
      const value = args as z.infer<typeof cozteToolInputSchemas.askQuestions>;
      return { ok: true, asked: value.questions.length, waitingForAnswers: true };
    }
  }
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
      : error instanceof ApiError ? error.message
      : "Error interno al guardar; el cambio no se aplicó.";
    output = { ok: false, error: message, ...(error instanceof ApiError || error instanceof z.ZodError ? {} : { technicalDetail: errorDetails(error).slice(0, 240) }) };
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
    askQuestions: tool({ description: describe.askQuestions, inputSchema: schemas.askQuestions, execute: execute("askQuestions") }),
  };
}
