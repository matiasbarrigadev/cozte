import { z } from "zod";
import type { AppView } from "./app-routes";
import type { ExplanationLevel } from "./cozte-levels";

/**
 * The discovery path: stages that lead a person from "what do you make?" to the business's numbers. A path is data,
 * not code: its stages, what completes each one (rules over the company's data), what each one opens and what Cozte
 * asks are configured, and can change without a release. Only a new completion rule needs code.
 */

export type BusinessMode = "project" | "operating";
export const BUSINESS_MODES: BusinessMode[] = ["project", "operating"];
export const BUSINESS_MODE_LABELS: Record<BusinessMode, string> = { project: "Proyecto", operating: "En marcha" };

/** What a company has, counted: the inputs of every completion rule. */
export type JourneyFacts = {
  products: number; productsWithRecipe: number; productsWithPrice: number;
  materialsUsed: number; materialsUsedPriced: number;
  /** Products whose recipe the person confirmed as complete. */
  recipesConfirmed: number;
  suppliers: number; purchases: number; productionExpenses: number;
  channels: number; channelsWithDelivery: number; deliveryZones: number;
  sales: number; deliveries: number; customers: number;
};

/** The completion rules a stage can combine (all of them must hold). A new rule is the only change that needs code. */
export const CONDITIONS = {
  product_with_recipe: { label: "Un producto con su receta", test: (f: JourneyFacts) => f.productsWithRecipe > 0 },
  materials_priced: { label: "Todos los insumos de las recetas con precio", test: (f: JourneyFacts) => f.materialsUsed > 0 && f.materialsUsedPriced === f.materialsUsed },
  recipe_confirmed: { label: "Una receta que confirmaste como completa", test: (f: JourneyFacts) => f.recipesConfirmed > 0 },
  supplier_or_purchase: { label: "Un proveedor o una compra registrada", test: (f: JourneyFacts) => f.suppliers + f.purchases > 0 },
  production_expense: { label: "Un gasto del lugar de producción", test: (f: JourneyFacts) => f.productionExpenses > 0 },
  sale_price: { label: "Un producto con precio de venta", test: (f: JourneyFacts) => f.productsWithPrice > 0 },
  sales_channel: { label: "Un canal de venta", test: (f: JourneyFacts) => f.channels > 0 },
  delivery_defined: { label: "Cómo se entrega: una zona o un canal con envío", test: (f: JourneyFacts) => f.deliveryZones > 0 || f.channelsWithDelivery > 0 },
  first_sale: { label: "Una venta registrada", test: (f: JourneyFacts) => f.sales > 0 },
} as const;
export type ConditionKey = keyof typeof CONDITIONS;
export const CONDITION_KEYS = Object.keys(CONDITIONS) as [ConditionKey, ...ConditionKey[]];

/** The workspace sections a path can open, with what each shows (said on its locked screen). */
export const MODULES = {
  asistente: { label: "Cozte AI", what: "Tu asistente: le contás y arma tus costos." },
  dashboard: { label: "Resumen", what: "Tu recorrido y cómo va todo de un vistazo." },
  planilla: { label: "Costos de producción", what: "Cuánto cuesta hacer cada producto: insumos, mano de obra y gastos del lugar." },
  historial: { label: "Historial", what: "Cómo fueron cambiando tus costos." },
  gastos: { label: "Gastos de la empresa", what: "Lo que pagás cada mes, separado en fijos y variables." },
  equilibrio: { label: "Punto de equilibrio", what: "Cuántas unidades de cada producto vender para cubrir tus gastos." },
  proveedores: { label: "Proveedores", what: "A quién le comprás cada insumo y cómo cambian sus precios." },
  compras: { label: "Compras", what: "Lo que comprás, con fecha y precio." },
  ventas: { label: "Ventas", what: "Anotar y cobrar lo que vendés, día a día." },
  canales: { label: "Canales", what: "Dónde y a quién vendés: comisiones, precios por canal y cuánto te deja cada uno." },
  entregas: { label: "Entregas", what: "Qué hay que entregar, dónde y cuándo, y lo que cuesta." },
  clientes: { label: "Clientes", what: "Quién te compra, cuánto y cada cuánto." },
  resultado: { label: "Resultado del mes", what: "Cuánto vendiste, gastaste y te quedó en el mes." },
  analisis: { label: "Análisis", what: "La evolución de tus costos y ventas." },
  presentaciones: { label: "Presentaciones", what: "Tus números listos para mostrar." },
} satisfies Partial<Record<AppView, { label: string; what: string }>>;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as [ModuleKey, ...ModuleKey[]];

const moduleList = z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length);
const stageSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, "El id de una etapa usa minúsculas, números y guiones"),
  title: z.string().trim().min(2).max(60),
  why: z.string().trim().min(5).max(200),
  completeWhen: z.array(z.enum(CONDITION_KEYS)).min(1).max(CONDITION_KEYS.length),
  unlocks: moduleList.default([]),
  /** What the person says to start the stage with Cozte. */
  prompt: z.string().trim().min(5).max(200),
  /** What Cozte finds out in the stage, in the order it asks. */
  interview: z.array(z.string().trim().min(3).max(200)).min(1).max(10),
  /** The idea taught with the company's own numbers when the stage is complete. */
  lesson: z.object({ title: z.string().trim().min(2).max(60), text: z.string().trim().min(5).max(300) }).optional(),
});

export const journeyDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(60),
  mode: z.enum(["project", "operating"]),
  stages: z.array(stageSchema).min(1).max(12).refine((stages) => new Set(stages.map((stage) => stage.id)).size === stages.length, "Cada etapa necesita un id distinto"),
  /** Open from the first day. */
  alwaysOpen: moduleList.default([]),
  /** About real operations: closed while the company does not sell yet. */
  sellingOnly: moduleList.default([]),
  /** Opened by the first sale. */
  afterFirstSale: moduleList.default([]),
  /** Where the path ends: the numbers it was walking towards. */
  finale: z.object({ title: z.string().trim().min(2).max(60), why: z.string().trim().min(5).max(200), prompt: z.string().trim().min(5).max(200) }),
});
export type JourneyDefinition = z.output<typeof journeyDefinitionSchema>;
export type JourneyStage = JourneyDefinition["stages"][number];

const ALWAYS: ModuleKey[] = ["asistente", "dashboard", "analisis", "presentaciones"];

/** The paths built into Cozte: one for projects still being planned, one for businesses already selling. */
export const DEFAULT_JOURNEYS: Record<BusinessMode, JourneyDefinition> = {
  project: {
    name: "Proyecto",
    mode: "project",
    alwaysOpen: ALWAYS,
    sellingOnly: ["ventas", "compras", "clientes", "resultado"],
    afterFirstSale: [],
    stages: [
      { id: "producto", title: "Qué querés producir", why: "Definir el producto y su receta es el punto de partida de cualquier costo.", completeWhen: ["product_with_recipe"], unlocks: ["planilla", "historial"], prompt: "Quiero armar mi proyecto: te cuento qué quiero producir.", interview: ["Qué producto o productos imagina y cómo se venden (unidad, paquete, tamaño)", "Cuántas unidades saldrían de una tanda y cuántas tandas haría al mes", "Qué insumos lleva cada unidad y en qué cantidad (la receta)"], lesson: { title: "Costo directo", text: "Lo que lleva cada unidad (sus insumos) es su costo directo: crece con cada unidad que hacés." } },
      { id: "insumos", title: "Cuánto cuestan los insumos", why: "Con precios reales de mercado sabés si el proyecto cierra antes de invertir.", completeWhen: ["recipe_confirmed", "materials_priced"], unlocks: ["proveedores"], prompt: "Busquemos cuánto cuestan los insumos de mi proyecto.", interview: ["Repasar la receta: si a un producto así suele faltarle algo, sugerirlo, y que la persona confirme que está completa", "Buscar en la web el precio actual de cada insumo, con fuente y fecha, y confirmarlo con la persona", "En qué presentación se compraría cada insumo (kilo, bolsa, caja) y dónde", "Si quiere que algún precio se actualice solo cada mes con el mercado"] },
      { id: "lugar", title: "Dónde producirías", why: "Producir en tu cocina o alquilar un local cambia mucho lo que necesitás vender.", completeWhen: ["production_expense"], unlocks: ["gastos", "canales"], prompt: "Pensemos dónde produciría y qué gastos tendría ese lugar.", interview: ["Dónde produciría: su casa, un local alquilado o una cocina compartida", "Qué servicios pagaría y cuánto: luz, gas, agua, internet, alquiler, impuestos", "Cuáles de esos gastos serían fijos y cuáles crecerían con la producción"], lesson: { title: "Fijos y variables", text: "Los gastos fijos se pagan igual aunque produzcas menos; los variables crecen con cada tanda. Los fijos son los que hay que cubrir vendiendo." } },
      { id: "venta", title: "Cómo venderías", why: "El canal y el precio deciden cuánto te queda por cada unidad.", completeWhen: ["sale_price", "sales_channel"], unlocks: ["equilibrio"], prompt: "Veamos cómo vendería mis productos y a qué precio.", interview: ["Por dónde vendería (feria, redes, comercios, mayoristas) y qué cobra cada canal", "A qué precio vendería cada producto; si no sabe, comparar con precios de mercado", "Comparar cuánto deja cada canal por unidad con un \"¿qué pasa si…?\""], lesson: { title: "Margen de contribución", text: "Lo que queda de cada venta después de sus costos variables es lo que paga los gastos fijos y, después, la ganancia." } },
      { id: "entrega", title: "Cómo entregarías", why: "Entregar también cuesta: si no lo contás, el margen se ve mejor de lo que es.", completeWhen: ["delivery_defined"], unlocks: ["entregas"], prompt: "Pensemos cómo entregaría los pedidos y cuánto costaría.", interview: ["Si entregaría en persona, con un repartidor o por un servicio de envíos", "Cuánto costaría cada entrega y quién la pagaría", "Qué zonas cubriría"] },
    ],
    finale: { title: "Evaluación del proyecto", why: "Costo por unidad, precio sugerido, cuánto vender por mes y qué inversión necesitás.", prompt: "Armemos la evaluación de mi proyecto." },
  },
  operating: {
    name: "Empresa en marcha",
    mode: "operating",
    alwaysOpen: ALWAYS,
    sellingOnly: [],
    afterFirstSale: ["resultado"],
    stages: [
      { id: "producto", title: "Qué producís", why: "Es la base: sin la receta de cada producto no hay costo.", completeWhen: ["product_with_recipe"], unlocks: ["planilla", "historial"], prompt: "Empecemos por lo que produzco: mis productos y su receta.", interview: ["Qué productos vende y cómo los vende (unidad, paquete, tamaño)", "Cuántas unidades buenas salen de una tanda y cuántas tandas hace al mes", "Qué insumos lleva cada unidad y en qué cantidad"], lesson: { title: "Costo directo", text: "Lo que lleva cada unidad (sus insumos) es su costo directo: crece con cada unidad que hacés." } },
      { id: "insumos", title: "De dónde vienen tus insumos", why: "Lo que pagás por cada insumo define buena parte de tu costo.", completeWhen: ["recipe_confirmed", "materials_priced"], unlocks: ["proveedores", "compras"], prompt: "Te cuento a quién le compro los insumos y cuánto pago.", interview: ["Repasar la receta: si a un producto así suele faltarle algo, sugerirlo, y que la persona confirme que está completa", "A quién le compra cada insumo y a qué precio (factura o lista)", "Cómo le llegan: flete, retiro, envío, y cuánto cuesta", "Si algún precio conviene actualizarlo solo cada mes con el mercado (combustible, tarifas)"] },
      { id: "lugar", title: "Dónde producís", why: "Sin los gastos del lugar, tu costo no incluye la luz ni el alquiler.", completeWhen: ["production_expense"], unlocks: ["gastos", "canales"], prompt: "Te cuento dónde produzco y qué pago cada mes.", interview: ["Dónde produce y si alquila", "Qué servicios paga y cuánto: luz, gas, agua, internet, impuestos municipales", "Cuáles de esos gastos son fijos y cuáles crecen con la producción"], lesson: { title: "Fijos y variables", text: "Los gastos fijos se pagan igual aunque produzcas menos; los variables crecen con cada tanda. Los fijos son los que hay que cubrir vendiendo." } },
      { id: "venta", title: "Dónde vendés", why: "El precio y los canales dicen cuánto te deja cada venta.", completeWhen: ["sale_price", "sales_channel"], unlocks: ["equilibrio", "ventas"], prompt: "Te cuento por dónde vendo, a qué precio y qué me cobra cada canal.", interview: ["Por dónde vende y qué comisión o costo tiene cada canal", "A qué precio vende cada producto en cada canal", "Cuánto vendió el último mes, aproximado, de cada producto"], lesson: { title: "Margen de contribución", text: "Lo que queda de cada venta después de sus costos variables es lo que paga los gastos fijos y, después, la ganancia." } },
      { id: "entrega", title: "Cómo entregás", why: "Entregar también cuesta: si no lo contás, el margen se ve mejor de lo que es.", completeWhen: ["delivery_defined"], unlocks: ["entregas", "clientes"], prompt: "Te cuento cómo entrego los pedidos y cuánto me cuesta.", interview: ["Si reparte por su cuenta, con un repartidor o por un servicio de envíos", "Cuánto le cuesta cada entrega y qué zonas cubre", "Quién paga el envío: el cliente o la empresa"] },
    ],
    finale: { title: "Tus números", why: "Cuánto te cuesta, cuánto te deja y cuánto tenés que vender cada mes.", prompt: "¿Cómo viene mi negocio este mes?" },
  },
};

export type StageStatus = "done" | "current" | "pending";
export type StageView = { id: string; title: string; why: string; prompt: string; interview: string[]; lesson: JourneyStage["lesson"] | null; status: StageStatus; missing: string[]; unlocks: ModuleKey[] };
export type ModuleAccess = { state: "open" | "locked"; reason?: string; stageId?: string; /** Advanced: open, with what is still missing. */ badge?: string };

export type JourneyView = {
  key: string; name: string; mode: BusinessMode; level: ExplanationLevel;
  stages: StageView[]; completed: number; total: number; current: StageView | null;
  finale: JourneyDefinition["finale"] & { ready: boolean };
  modules: Record<ModuleKey, ModuleAccess>;
  /** Opened by this load, to celebrate once. */
  newlyUnlocked: ModuleKey[];
};

/** Each stage's state from the company's data: done when every rule holds; the first one not done is the current one. */
export function stageViews(definition: JourneyDefinition, facts: JourneyFacts): StageView[] {
  let currentFound = false;
  return definition.stages.map((stage) => {
    const missing = stage.completeWhen.filter((key) => !CONDITIONS[key].test(facts)).map((key) => CONDITIONS[key].label);
    const status: StageStatus = missing.length === 0 ? "done" : currentFound ? "pending" : "current";
    if (status === "current") currentFound = true;
    return { id: stage.id, title: stage.title, why: stage.why, prompt: stage.prompt, interview: stage.interview, lesson: stage.lesson ?? null, status, missing, unlocks: stage.unlocks };
  });
}

/**
 * What each section is for this person. Advanced sees everything, with what is missing; simple and medium open
 * sections as stages complete. Sections about real sales wait for the first sale in a project. Once opened, a section
 * stays open, and one that already has data of its own is never closed.
 */
export function moduleAccess(definition: JourneyDefinition, input: { mode: BusinessMode; level: ExplanationLevel; unlockAll: boolean; completed: ReadonlySet<string>; unlocked: ReadonlySet<string>; withData: ReadonlySet<ModuleKey>; firstSale: boolean }): Record<ModuleKey, ModuleAccess> {
  const access = {} as Record<ModuleKey, ModuleAccess>;
  for (const section of MODULE_KEYS) {
    let locked: { reason: string; badge: string; stageId?: string } | null = null;
    if (definition.alwaysOpen.includes(section) || input.unlockAll || input.unlocked.has(section) || input.withData.has(section)) locked = null;
    else if (input.mode === "project" && definition.sellingOnly.includes(section)) locked = { reason: "Se habilita cuando empieces a vender", badge: "Cuando vendas" };
    else if (definition.afterFirstSale.includes(section) && !input.firstSale) locked = { reason: "Se habilita con tu primera venta", badge: "Primera venta" };
    else {
      const stage = definition.stages.find((item) => item.unlocks.includes(section));
      if (stage && !input.completed.has(stage.id)) locked = { reason: `Se habilita al completar «${stage.title}»`, badge: `Falta: ${stage.title}`, stageId: stage.id };
    }
    access[section] = !locked ? { state: "open" }
      : input.level === "advanced" ? { state: "open", badge: locked.badge, ...(locked.stageId ? { stageId: locked.stageId } : {}) }
      : { state: "locked", reason: locked.reason, ...(locked.stageId ? { stageId: locked.stageId } : {}) };
  }
  return access;
}

/** The section that a nested view belongs to, for its access. */
export function moduleOfView(view: AppView): ModuleKey {
  if (view === "producto") return "planilla";
  if (view === "presentacion") return "presentaciones";
  return view as ModuleKey;
}

/** A definition from storage, or the built-in one when it is missing or no longer valid. */
export function parseJourneyDefinition(json: string | null | undefined, fallback: JourneyDefinition): { definition: JourneyDefinition; error: string | null } {
  if (!json) return { definition: fallback, error: null };
  try {
    const parsed = journeyDefinitionSchema.safeParse(JSON.parse(json));
    return parsed.success ? { definition: parsed.data, error: null } : { definition: fallback, error: parsed.error.issues[0]?.message ?? "Definición inválida" };
  } catch {
    return { definition: fallback, error: "No es un JSON válido" };
  }
}
