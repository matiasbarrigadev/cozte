import "server-only";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { ADMIN_VIEW_COOKIE, adminViewOrganization } from "./platform-admin";

export type Principal = {
  userId: string;
  organizationId: string;
  role: "owner" | "editor" | "viewer";
  /** A Cozte superadmin viewing an organization they do not belong to: read-only, and never a member of it. */
  adminView?: { email: string };
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Who is asking and for which organization: the active organization of the Clerk session, or the one a superadmin
 * chose to view (always read-only). Null when there is no session, or no organization to work on.
 */
export async function sessionPrincipal(): Promise<{ userId: string | null; principal: Principal | null }> {
  const session = await auth();
  if (!session.userId) return { userId: null, principal: null };
  const viewing = (await cookies()).get(ADMIN_VIEW_COOKIE)?.value;
  const admin = viewing ? await adminViewOrganization(session.userId, viewing) : null;
  if (admin) return { userId: session.userId, principal: { userId: session.userId, organizationId: admin.organizationId, role: "viewer", adminView: { email: admin.email } } };
  if (!session.orgId) return { userId: session.userId, principal: null };
  const role = session.orgRole === "org:admin" ? "owner" : session.orgRole === "org:member" ? "editor" : "viewer";
  return { userId: session.userId, principal: { userId: session.userId, organizationId: session.orgId, role } };
}

export async function requirePrincipal(write = false): Promise<Principal> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    throw new ApiError(503, "El acceso aún no está configurado");
  }
  const { userId, principal } = await sessionPrincipal();
  if (!userId) throw new ApiError(401, "Inicia sesión para continuar");
  if (!principal) throw new ApiError(403, "Selecciona una empresa para continuar");
  if (write && principal.adminView) throw new ApiError(403, "Estás viendo esta empresa como superadmin: es solo lectura");
  if (write && principal.role === "viewer") throw new ApiError(403, "No tienes permiso para modificar costos");
  return principal;
}

/** Actions that write for the organization even to its readers (Cozte's chat and settings) are closed to a superadmin. */
export function forbidAdminView(principal: Principal): void {
  if (principal.adminView) throw new ApiError(403, "Estás viendo esta empresa como superadmin: es solo lectura");
}

export function apiFailure(error: unknown): Response {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("API request failed", error);
  return Response.json({ error: "No pudimos completar la operación" }, { status: 500 });
}
