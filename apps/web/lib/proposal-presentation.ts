import { formatMoney } from "./money";
import type { Currency } from "./currency";
import type { DomainState, ProductCost } from "./domain";
import type { ProductionProfile, ProfileCost } from "./production-profile";

export type ProposalSection = { title: string; lines: string[] };
export type ProposalDetails = { sections: ProposalSection[]; blockers?: string[] };
export type ProposalPresentation = { title: string; summary: string; details: ProposalDetails };

const shown = (value: number | null | undefined, suffix = "") => value == null ? "dato pendiente" : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value)}${suffix}`;

export function productionProfilePresentation(profile: ProductionProfile, gaps: string[], referenceErrors: string[] = [], evaluation?: { currency: Currency; costs: ProfileCost[] }): ProposalPresentation {
  const products = profile.products.map((item) => {
    const output = `${shown(item.goodUnitsPerBatch)} unidades aptas por lote`;
    const volume = item.batchesPerMonth == null ? "volumen mensual pendiente" : `${shown(item.batchesPerMonth)} lotes/mes`;
    const scrap = item.normalScrapUnitsPerBatch == null ? "merma normal pendiente" : `${shown(item.normalScrapUnitsPerBatch)} de merma/lote`;
    return `${item.name} · terminado en ${item.finishedUnit} · ${output} · ${volume} · ${scrap}`;
  });
  const site = profile.site ? `${profile.site.name}${profile.site.location ? ` · ${profile.site.location}` : ""}` : "Ubicación por definir";
  const stages = profile.stages.map((stage) => stage.notes ? `${stage.name}: ${stage.notes}` : stage.name);
  const inputs = profile.inputs.map((item) => {
    const usage = item.usage.length ? item.usage.map((use) => `${use.product}: ${shown(use.quantityPerBatch)} ${item.consumptionUnit}/lote`).join("; ") : "sin productos vinculados";
    const price = item.pricePerPurchase !== undefined ? `${shown(item.pricePerPurchase)} ${item.priceCurrency ?? "moneda base"}` : item.pricePerPurchaseMinor != null ? `${shown(item.pricePerPurchaseMinor)} ${item.priceCurrency ?? "moneda base"}` : "precio pendiente";
    return `${item.name} · ${item.category} · compra en ${item.purchaseUnit}, uso en ${item.consumptionUnit} · ${usage} · ${price}`;
  });
  const recurringCosts = profile.recurringCosts.map((item) => {
    const amount = item.amount !== undefined ? `${shown(item.amount)} ${item.amountCurrency ?? "moneda base"}` : item.amountMinor != null ? `${shown(item.amountMinor)} ${item.amountCurrency ?? "moneda base"}` : "importe pendiente";
    const frequency = item.frequency === "annual" ? "anual" : item.frequency === "quarterly" ? "trimestral" : "mensual";
    const allocation = item.allocation === "production_hours" ? "horas de producción" : item.allocation === "finished_units" ? "unidades aptas" : "porcentajes acordados";
    return `${item.name} · ${item.category} · ${amount} ${frequency} · reparto por ${allocation}`;
  });
  const blocking = referenceErrors.length ? referenceErrors : [];
  const evaluatedCosts = evaluation?.costs.map((cost) => {
    const product = profile.products.find((item) => item.name.toLocaleLowerCase() === cost.product.toLocaleLowerCase());
    return cost.unitMinor === null
      ? `${cost.product}: todavía sin costo unitario calculable${cost.warnings.length ? ` · ${cost.warnings.join("; ")}` : ""}`
      : `${cost.product}: ${money(cost.unitMinor, evaluation.currency)} por ${product?.finishedUnit ?? "unidad"}`;
  });
  const title = profile.products.length > 1
    ? `Propuesta: Evaluar mapa con ${profile.products.length} productos`
    : profile.products.length === 1
      ? `Propuesta: Evaluar ${profile.products[0].name}`
      : "Propuesta: Revisar mapa de producción";
  const brief = profile.businessSummary.trim() || "Ordenar qué se produce, dónde y cómo antes de llevar el mapa a los costos vigentes.";
  const sections: ProposalSection[] = [
    { title: "Qué propone Cozte", lines: [brief, "Al aprobar, se inicia el seguimiento de evaluación con una revisión versionada del mapa. No cambia costos vigentes ni crea fichas de la planilla."] },
    { title: `Productos incluidos (${profile.products.length})`, lines: products.length ? products : ["Todavía no hay productos definidos."] },
    ...(evaluatedCosts ? [{ title: "Costo unitario calculado por el motor", lines: evaluatedCosts.length ? evaluatedCosts : ["Todavía no hay productos para calcular."] }] : []),
    { title: "Dónde y cómo se produce", lines: [site, ...(stages.length ? stages : ["Etapas del proceso pendientes."])] },
    { title: "Insumos directos", lines: inputs.length ? inputs : ["No se han registrado insumos."] },
    { title: "Gastos y servicios compartidos", lines: recurringCosts.length ? recurringCosts : ["No se han registrado gastos compartidos."] },
    { title: "Categorías acordadas", lines: profile.categories.length ? profile.categories.map((item) => item.name) : ["Pendientes de acordar."] },
    ...(gaps.length ? [{ title: "Datos que faltan", lines: gaps }] : []),
    ...(blocking.length ? [{ title: "Revisar antes de aprobar", lines: blocking }] : []),
  ];
  const context = profile.site ? ` en ${site}` : "";
  const productNames = profile.products.length ? profile.products.map((item) => item.name).join(" y ") : "el proceso productivo";
  return { title, summary: `${brief} ${profile.products.length ? `Incluye ${productNames}${context}.` : `Ubicación: ${site}.`}`, details: { sections, ...(blocking.length ? { blockers: blocking } : {}) } };
}

function mutationTitle(input: Record<string, unknown>, supplied?: string): string {
  if (input.action === "create-products" && Array.isArray(input.products)) return `Propuesta: Crear estos ${input.products.length} productos`;
  if (input.action === "create-product" && typeof input.name === "string") return `Propuesta: Crear producto ${input.name}`;
  if (input.action === "delete-product" || input.action === "delete-material") {
    const label = supplied?.trim().replace(/^propuesta:\s*/i, "");
    return `Propuesta: ${label || `${input.action === "delete-product" ? "Eliminar producto" : "Eliminar insumo"} ${String(input.id)}`}`;
  }
  if (input.action === "create-material" && typeof input.name === "string") return `Propuesta: Agregar insumo ${input.name}`;
  if (input.action === "create-expense" && typeof input.name === "string") return `Propuesta: Agregar gasto ${input.name}`;
  const label = supplied?.trim();
  return label ? `Propuesta: ${label.replace(/^propuesta:s*/i, "")}` : "Propuesta: Actualizar costos de producción";
}

function money(value: number | null, currency: Currency): string {
  return value === null ? "sin base suficiente" : formatMoney(value, currency);
}

function mutationLines(state: DomainState, input: Record<string, unknown>): string[] {
  const product = state.products.find((item) => item.id === input.productId || item.id === input.id);
  const material = state.materials.find((item) => item.id === input.materialId || item.id === input.id);
  const expense = state.expenses.find((item) => item.id === input.id || item.id === input.expenseId);
  switch (input.action) {
    case "create-product": return [
      `Producto terminado: ${String(input.name)}`,
      `Unidades por lote: ${shown(Number(input.lotUnits))}`,
      `Precio de venta por unidad: ${money(Number(input.salePriceMinor), state.organization.currency)}`,
      `Gastos variables de venta por unidad: ${money(Number(input.salesVariableMinor), state.organization.currency)}`,
      `Mano de obra por lote: ${money(Number(input.laborLotMinor), state.organization.currency)}`,
      `Horas de producción por lote: ${shown(Number(input.productionHoursMilli) / 1000, " h")}`,
      ...(input.cloneProductId ? [`Basado en: ${state.products.find((item) => item.id === input.cloneProductId)?.name ?? "otro producto"}`] : []),
      ...(!input.cloneProductId ? ["Composición inicial vacía: los insumos y consumos se cargarán por separado."] : []),
    ];
    case "create-products": return ((input.products as Array<Record<string, unknown>> | undefined) ?? []).flatMap((item) => [
      `Producto terminado: ${String(item.name)}`,
      `Unidades por lote: ${shown(Number(item.lotUnits))}`,
      `Precio de venta por unidad: ${money(Number(item.salePriceMinor), state.organization.currency)}`,
      `Gastos variables de venta por unidad: ${money(Number(item.salesVariableMinor), state.organization.currency)}`,
      `Mano de obra por lote: ${money(Number(item.laborLotMinor), state.organization.currency)}`,
      `Horas de producción por lote: ${shown(Number(item.productionHoursMilli) / 1000, " h")}`,
      ...(item.cloneProductId ? [`Composición basada en: ${state.products.find((product) => product.id === item.cloneProductId)?.name ?? "otro producto"}`] : ["Composición inicial vacía: los insumos y consumos se cargarán por separado."]),
    ]);
    case "update-product": return [
      `Producto: ${product?.name ?? String(input.id)} → ${String(input.name)}`,
      `Unidades por lote: ${shown(product?.lotUnits)} → ${shown(Number(input.lotUnits))}`,
      `Precio de venta por unidad: ${money(product?.salePriceMinor ?? null, state.organization.currency)} → ${money(Number(input.salePriceMinor), state.organization.currency)}`,
      `Gastos variables de venta por unidad: ${money(product?.salesVariableMinor ?? null, state.organization.currency)} → ${money(Number(input.salesVariableMinor), state.organization.currency)}`,
      `Mano de obra por lote: ${money(product?.laborLotMinor ?? null, state.organization.currency)} → ${money(Number(input.laborLotMinor), state.organization.currency)}`,
      `Horas de producción por lote: ${shown(product ? product.productionHoursMilli / 1000 : null, " h")} → ${shown(Number(input.productionHoursMilli) / 1000, " h")}`,
    ];
    case "create-material": return [
      `Insumo: ${String(input.name)} · categoría ${String(input.category ?? "Materia prima")}`,
      `Unidad de compra: ${String(input.purchaseUnit)}`,
      `Proveedor: ${String(input.supplier || "por definir")}`,
      input.price === undefined ? "Precio: pendiente" : `Precio de compra: ${shown(Number(input.price))} ${String(input.currency ?? state.organization.currency)}`,
    ];
    case "create-expense": return [
      `Gasto compartido: ${String(input.name)} · ${String(input.category ?? "Gastos generales")}`,
      `Importe: ${shown(Number(input.amount))} ${String(input.currency)} · período ${String(input.period)}`,
      `Criterio de reparto: ${input.allocationBasis === "hours" ? "horas de producción" : input.allocationBasis === "units" ? "unidades aptas" : "porcentajes manuales"}`,
    ];
    case "delete-product": return [
      `Producto: ${product?.name ?? String(input.id)}`,
      "Se quitará de los costos y cálculos vigentes; el historial se conserva.",
      "Los gastos con reparto manual se normalizan según los porcentajes que tenían los productos restantes; si no queda una base válida, el costo se marca como pendiente de reparto.",
    ];
    case "delete-material": return [
      `Insumo: ${material?.name ?? String(input.id)}`,
      "Se quitará del catálogo, de las composiciones y de los costos vigentes; el historial se conserva.",
    ];
    case "set-component": return [
      `Producto: ${product?.name ?? String(input.productId)}`,
      `Insumo: ${material?.name ?? String(input.materialId)}`,
      `Consumo por lote: ${shown(Number(input.quantityMilli) / 1000, ` ${material?.purchaseUnit ?? "unidades de compra"}`)}`,
    ];
    case "update-material-meta": return [`Insumo: ${material?.name ?? String(input.id)}`, `${String(input.field)}: ${String(input.value)}`];
    case "update-expense-meta": return [`Gasto: ${expense?.name ?? String(input.id)}`, input.field === "period" ? `Período: ${String(input.value)}` : `${String(input.field)}: ${String(input.value)}`];
    case "update-expense-allocation": return [`Gasto: ${expense?.name ?? String(input.id)}`, `Nuevo reparto: ${input.basis === "hours" ? "horas" : input.basis === "units" ? "unidades" : "porcentajes manuales"}`];
    case "update-expense-behavior": return [`Gasto: ${expense?.name ?? String(input.id)}`, input.behavior === "fixed" ? "Pasa a ser fijo" : `Crece con ${input.driver === "unit" ? "cada unidad" : input.driver === "lot" ? "cada tanda" : "cada hora de producción"}${input.behavior === "mixed" ? ` (el ${String(input.variablePercent)} % del gasto)` : ""}`];
    case "create-category": return [`Nueva categoría: ${String(input.name)}`];
    case "rename-category": return [`Categoría: ${state.categories?.find((item) => item.id === input.id)?.name ?? String(input.id)} → ${String(input.name)}`];
    case "bulk-prices": {
      const lines = [
        ...((input.materials as Array<{ id: string; amount: number; currency: string }> | undefined) ?? []).map((item) => `Insumo ${state.materials.find((row) => row.id === item.id)?.name ?? item.id}: ${shown(item.amount)} ${item.currency} por ${state.materials.find((row) => row.id === item.id)?.purchaseUnit ?? "unidad"}`),
        ...((input.expenses as Array<{ id: string; amount: number; currency: string }> | undefined) ?? []).map((item) => `Gasto ${state.expenses.find((row) => row.id === item.id)?.name ?? item.id}: ${shown(item.amount)} ${item.currency}`),
      ];
      return lines.length ? lines : ["Actualizar precios y gastos seleccionados."];
    }
    default: return ["Revisar el cambio de costo propuesto."];
  }
}

export function mutationProposalPresentation(
  state: DomainState,
  input: Record<string, unknown>,
  before: ProductCost[],
  after: ProductCost[],
  options: { label?: string; brief?: string } = {},
): ProposalPresentation {
  const changes = mutationLines(state, input);
  const beforeById = new Map(before.map((item) => [item.productId, item]));
  const impact = after.flatMap((item) => {
    const previous = beforeById.get(item.productId);
    if (previous && previous.unitMinor === item.unitMinor && previous.totalLotMinor === item.totalLotMinor) return [];
    const createdProducts = (input.products as Array<{ name: string }> | undefined) ?? [];
    const createdName = input.action === "create-product" ? String(input.name) : item.productId.startsWith("new:") ? createdProducts[Number(item.productId.slice(4))]?.name : undefined;
    const name = state.products.find((product) => product.id === item.productId)?.name ?? createdName ?? item.productId;
    return [`${name}: ${money(previous?.unitMinor ?? null, state.organization.currency)} → ${money(item.unitMinor, state.organization.currency)} por unidad terminada`];
  });
  const names = input.action === "create-products" ? ((input.products as Array<{ name: string }> | undefined) ?? []).map((item) => item.name) : input.action === "create-product" && typeof input.name === "string" ? [input.name] : [];
  const productContext = names.length > 1 ? `Crear fichas iniciales para ${names.slice(0, -1).join(", ")} y ${names.at(-1)}.` : names.length === 1 ? `Crear una ficha inicial para ${names[0]}.` : "";
  const suppliedBrief = options.brief?.trim() || productContext || "Cozte propone el cambio descrito para que lo revises antes de aplicarlo.";
  const brief = productContext && !names.every((name) => suppliedBrief.toLocaleLowerCase().includes(name.toLocaleLowerCase())) ? `${suppliedBrief} ${productContext}` : suppliedBrief;
  const suppliedTitle = input.action === "create-product" ? undefined : options.label;
  const sections: ProposalSection[] = [
    { title: "Resumen", lines: [brief] },
    { title: "Cambio propuesto", lines: changes },
    { title: "Impacto calculado", lines: impact.length ? impact : ["No cambia todavía un costo unitario calculable con los datos disponibles."] },
    { title: "Control", lines: ["Nada se aplica hasta que apruebes esta propuesta.", ...(names.length ? ["Crear la ficha no inventa insumos ni consumos: esos se agregan y revisan aparte."] : []), ...(input.action === "delete-product" || input.action === "delete-material" ? ["No se borra el historial contable: solo se archiva este elemento para los costos futuros."] : [])] },
  ];
  return { title: mutationTitle(input, suppliedTitle), summary: brief, details: { sections } };
}
