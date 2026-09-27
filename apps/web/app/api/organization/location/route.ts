import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { saveOrganizationLocation } from "@/lib/server/organization-location";

export const runtime = "nodejs";

/** Where the business is: country, city and timezone. */
export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    return Response.json(await saveOrganizationLocation(principal, await request.json(), "user"));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Ubicación inválida" }, { status: 400 });
    return apiFailure(error);
  }
}
