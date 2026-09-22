import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadState } from "@/lib/server/state";
import { officialFxTable, quotesFor } from "@/lib/server/fx";

export const runtime = "nodejs";

export async function GET() {
  try {
    const principal = await requirePrincipal();
    const state = await loadState(principal);
    const table = await officialFxTable();
    return Response.json({ base: state.organization.currency, quotes: quotesFor(state.organization.currency, table), asOf: table.asOf, source: table.source }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
