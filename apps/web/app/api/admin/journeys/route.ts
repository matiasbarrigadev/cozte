import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/server/auth";
import { resetJourneyDefinition, saveJourneyDefinition } from "@/lib/server/journey";
import { superadminEmail } from "@/lib/server/platform-admin";

export const runtime = "nodejs";

async function superadmin(request: Request): Promise<string | null> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return null;
  const session = await auth();
  return session.userId && await superadminEmail(session.userId) ? session.userId : null;
}

/** A superadmin saves a discovery path (validated) or brings back the built-in one. Takes effect without a release. */
export async function PUT(request: Request) {
  const userId = await superadmin(request);
  if (!userId) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  try {
    const { key, json } = z.object({ key: z.string(), json: z.string().max(60_000) }).parse(await request.json());
    return NextResponse.json({ definition: await saveJourneyDefinition(userId, key, json) });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    console.error("Journey save failed", error);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await superadmin(request);
  if (!userId) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^[a-z0-9-]{2,40}$/.test(key)) return NextResponse.json({ error: "Clave inválida" }, { status: 400 });
  await resetJourneyDefinition(key);
  return NextResponse.json({ ok: true });
}
