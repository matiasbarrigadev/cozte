import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadChannels, loadDeliveries } from "@/lib/server/business";

export const runtime = "nodejs";

/** A month's deliveries plus every open one, closest to today first, with the channels for their forms. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Elige un mes válido");
    const [deliveries, channels] = await Promise.all([loadDeliveries(principal, month), loadChannels(principal)]);
    return Response.json({ month, deliveries, channels }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
