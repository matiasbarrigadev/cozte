import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadCostsAt } from "@/lib/server/cost-insights";

export const runtime = "nodejs";

/** Every product's detailed cost at the end of ?date=YYYY-MM-DD. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return Response.json({ error: "Elige una fecha válida" }, { status: 400 });
    return Response.json(await loadCostsAt(principal, date), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
