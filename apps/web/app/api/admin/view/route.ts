import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ADMIN_VIEW_COOKIE, adminViewOrganization, recordAdminAccess, superadminEmail } from "@/lib/server/platform-admin";

export const runtime = "nodejs";

/**
 * A superadmin opens an organization (form field `organizationId`) or leaves it (`action=exit`). Only a form posted
 * from Cozte itself is accepted; the choice is kept in an httpOnly cookie and every opening is logged.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const session = await auth();
  if (!session.userId || !(await superadminEmail(session.userId))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const form = await request.formData();
  if (form.get("action") === "exit") {
    const response = NextResponse.redirect(new URL("/admin", url), 303);
    response.cookies.delete(ADMIN_VIEW_COOKIE);
    return response;
  }
  const chosen = await adminViewOrganization(session.userId, String(form.get("organizationId") ?? ""));
  if (!chosen) return NextResponse.json({ error: "Esa empresa no existe" }, { status: 404 });
  await recordAdminAccess(session.userId, chosen.email, chosen.organizationId);
  const response = NextResponse.redirect(new URL("/app", url), 303);
  response.cookies.set(ADMIN_VIEW_COOKIE, chosen.organizationId, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/", maxAge: 8 * 3600 });
  return response;
}
