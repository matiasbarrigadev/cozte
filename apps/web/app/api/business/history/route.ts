import { clerkClient } from "@clerk/nextjs/server";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadRecordHistory } from "@/lib/server/business";

export const runtime = "nodejs";

/** Team members' names, so a history says who changed what; missing names read "Alguien del equipo". */
async function teamNames(userIds: string[]): Promise<Record<string, string>> {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ userId: userIds, limit: userIds.length });
  return Object.fromEntries(data.map((user) => [user.id, [user.firstName, user.lastName].filter(Boolean).join(" ") || user.primaryEmailAddress?.emailAddress || "Alguien del equipo"]));
}

/** The changes of one sale, delivery or purchase, newest first. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    const id = params.get("id");
    if ((kind !== "sale" && kind !== "delivery" && kind !== "purchase") || !id || id.length > 120) throw new ApiError(400, "Indica qué registro ver");
    return Response.json({ events: await loadRecordHistory(principal, kind, id, teamNames) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
