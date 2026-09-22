import "server-only";
import { auth } from "@clerk/nextjs/server";

export type Principal = {
  userId: string;
  organizationId: string;
  role: "owner" | "editor" | "viewer";
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requirePrincipal(write = false): Promise<Principal> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    throw new ApiError(503, "El acceso aún no está configurado");
  }
  const session = await auth();
  if (!session.userId) throw new ApiError(401, "Inicia sesión para continuar");
  if (!session.orgId) throw new ApiError(403, "Selecciona una empresa para continuar");
  const role = session.orgRole === "org:admin" ? "owner" : session.orgRole === "org:member" ? "editor" : "viewer";
  if (write && role === "viewer") throw new ApiError(403, "No tienes permiso para modificar costos");
  return { userId: session.userId, organizationId: session.orgId, role };
}

export function apiFailure(error: unknown): Response {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("API request failed", error);
  return Response.json({ error: "No pudimos completar la operación" }, { status: 500 });
}
