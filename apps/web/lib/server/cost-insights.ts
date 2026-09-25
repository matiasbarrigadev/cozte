import "server-only";
import { generateText } from "ai";
import { analyzeCosts, costsAt, groupComponents, type CostAnalysis, type CostsAt, type Granularity, type SnapshotRow } from "@/lib/cost-analysis";
import { verifyCozteResponse } from "@/lib/cozte-response-verifier";
import type { Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { loadState } from "./state";
import { cozteAgentSettings, cozteProviderOptions } from "./cozte-workflow";

const HISTORY_DAYS = 400;
const MAX_SNAPSHOTS = 4000;

async function loadSnapshots(principal: Principal, until?: string) {
  return Promise.all([
    loadState(principal),
    dbQuery<SnapshotRow>(
      `SELECT product_id, total_lot_minor, unit_minor, lines_json, warnings_json, context_json, created_at FROM cost_snapshots WHERE organization_id=? AND created_at >= datetime('now', ?)${until ? " AND created_at <= ?" : ""} ORDER BY created_at DESC LIMIT ?`,
      [principal.organizationId, `-${HISTORY_DAYS} days`, ...(until ? [`${until} 23:59:59`] : []), MAX_SNAPSHOTS],
    ),
  ]);
}

export async function loadCostAnalysis(principal: Principal, granularity: Granularity): Promise<CostAnalysis> {
  const [state, rows] = await loadSnapshots(principal);
  // Only products that still exist are analyzed; archived ones keep their history elsewhere.
  const current = new Set(state.products.map((product) => product.id));
  return analyzeCosts(rows.filter((row) => current.has(row.product_id)), {
    granularity, currency: state.organization.currency,
    productNames: Object.fromEntries(state.products.map((product) => [product.id, product.name])),
  });
}

/** Compact, figure-bearing summary the model may quote from. */
export function insightSource(analysis: CostAnalysis) {
  return {
    currency: analysis.currency,
    granularity: analysis.granularity === "week" ? "semanas" : "meses",
    periods: analysis.periods.length,
    firstPeriod: analysis.periods[0],
    lastPeriod: analysis.periods.at(-1),
    products: analysis.products.map((product) => {
      const latest = [...product.points].reverse().find((point) => point.unitCost !== null && !point.incomplete);
      return {
        product: product.name,
        unitCostNow: latest?.unitCost ?? null,
        monthlyCostNow: latest?.monthlyCost ?? null,
        compositionNowPerUnit: latest ? groupComponents(latest, analysis.components, "concept") : null,
        compositionByCategoryPerUnit: latest ? groupComponents(latest, analysis.components, "category") : null,
        change: product.change ? { from: product.change.from, to: product.change.to, delta: product.change.delta, deltaPercent: product.change.deltaPercent, mainDrivers: product.change.drivers.slice(0, 5) } : null,
      };
    }),
    monthlyProductionCost: analysis.totals.filter((total) => total.monthlyProductionCost !== null).map((total) => ({ period: total.period, value: total.monthlyProductionCost })),
    findings: analysis.insights.map((insight) => `${insight.title}. ${insight.detail}`),
  };
}

const SYSTEM = `Eres Cozte, asesora de costos de producción y educadora financiera para emprendimientos y pymes. Recibes un análisis ya calculado de cómo evolucionaron los costos de una empresa. Tu trabajo es explicarlo para cualquier persona, sin jerga, y proponer acciones concretas.

Responde en español, breve, con exactamente estas secciones en negrita: **Qué pasó**, **Oportunidades de mejora**, **Riesgos a vigilar**. Usa viñetas cortas (máximo 3 por sección). Cierra con una línea "> **Para entender:** …" que enseñe una idea financiera con sus números.

Reglas: usa solo montos y porcentajes que aparecen en los datos; no hagas cuentas nuevas ni inventes cifras. Si el historial es corto, dilo y enfoca las recomendaciones en qué registrar para que el análisis sea útil. No des consejos fiscales ni legales. No uses títulos con #, emojis ni tablas.`;

export async function generateCostInsights(analysis: CostAnalysis): Promise<{ text: string; verified: boolean }> {
  const settings = cozteAgentSettings();
  const source = JSON.stringify(insightSource(analysis));
  const ask = (extra?: string) => generateText({
    model: settings.model,
    system: SYSTEM,
    prompt: `Datos del análisis (JSON):\n${source}${extra ? `\n\n${extra}` : ""}`,
    maxOutputTokens: settings.maxOutputTokens,
    providerOptions: cozteProviderOptions(settings),
  });
  // Same rule as the chat: a figure the data does not contain is not shown.
  const check = (text: string) => verifyCozteResponse(text, [], { sources: [source] }).issues.filter((issue) => issue.code === "unverified-figures");
  let result = await ask();
  let problems = check(result.text);
  if (problems.length) {
    result = await ask(`Tu respuesta anterior usó montos que no están en los datos (${problems.map((issue) => issue.detail).join(" ")}). Vuelve a escribirla usando solo cifras que aparecen en el JSON.`);
    problems = check(result.text);
  }
  return { text: result.text.trim(), verified: problems.length === 0 };
}

/** Detailed costs of every current product as they stood at the end of a day. */
export async function loadCostsAt(principal: Principal, date: string): Promise<CostsAt> {
  const [state, rows] = await loadSnapshots(principal, date);
  const current = new Set(state.products.map((product) => product.id));
  return costsAt(rows.filter((row) => current.has(row.product_id)), date, {
    currency: state.organization.currency,
    productNames: Object.fromEntries(state.products.map((product) => [product.id, product.name])),
  });
}

export type SavedInsight = { id: string; createdAt: string; granularity: Granularity; text: string; verified: boolean; firstPeriod: string | null; lastPeriod: string | null };

export async function saveCostInsight(principal: Principal, analysis: CostAnalysis, result: { text: string; verified: boolean }): Promise<SavedInsight> {
  const id = crypto.randomUUID();
  const [rows] = await dbBatch<{ created_at: string }>([{
    sql: "INSERT INTO cost_insights (id, organization_id, created_by, granularity, text, verified, source_json, first_period, last_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING created_at",
    params: [id, principal.organizationId, principal.userId, analysis.granularity, result.text, result.verified ? 1 : 0, JSON.stringify(insightSource(analysis)), analysis.periods[0] ?? null, analysis.periods.at(-1) ?? null],
  }]);
  return { id, createdAt: rows[0]?.created_at ?? new Date().toISOString(), granularity: analysis.granularity, text: result.text, verified: result.verified, firstPeriod: analysis.periods[0] ?? null, lastPeriod: analysis.periods.at(-1) ?? null };
}

export async function listCostInsights(principal: Principal): Promise<SavedInsight[]> {
  const rows = await dbQuery<{ id: string; created_at: string; granularity: Granularity; text: string; verified: number; first_period: string | null; last_period: string | null }>(
    "SELECT id, created_at, granularity, text, verified, first_period, last_period FROM cost_insights WHERE organization_id=? ORDER BY created_at DESC LIMIT 50",
    [principal.organizationId],
  );
  return rows.map((row) => ({ id: row.id, createdAt: row.created_at, granularity: row.granularity, text: row.text, verified: row.verified === 1, firstPeriod: row.first_period, lastPeriod: row.last_period }));
}
