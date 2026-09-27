import { businessToday } from "@/lib/business";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadChannels, loadDeliveries } from "@/lib/server/business";
import { loadZonePlaces, loadZones } from "@/lib/server/delivery-zones";

export const runtime = "nodejs";

/** A month's deliveries plus every open one, closest to today first, with the channels, the zones and where customers receive. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const month = new URL(request.url).searchParams.get("month") ?? businessToday().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Elige un mes válido");
    const [deliveries, channels, zones, places] = await Promise.all([loadDeliveries(principal, month), loadChannels(principal), loadZones(principal), loadZonePlaces(principal)]);
    return Response.json({ month, deliveries, channels, zones, places }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
