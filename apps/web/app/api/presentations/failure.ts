import { z } from "zod";
import { DeckError } from "@/lib/decks";
import { apiFailure } from "@/lib/server/auth";

/** Validation and deck errors become readable 400s; everything else goes through the shared handler. */
export function presentationFailure(error: unknown): Response {
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  if (error instanceof DeckError) return Response.json({ error: error.message, options: error.options }, { status: 400 });
  return apiFailure(error);
}
