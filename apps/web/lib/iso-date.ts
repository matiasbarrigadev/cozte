import { z } from "zod";

/**
 * Date shape exposed to workflow tools. Ajv in @ai-sdk/workflow does not load
 * format validators, so `z.iso.date()` (format: date) cannot cross that step
 * boundary. The full calendar-date check remains in the canonical Zod schema
 * when the tool executes.
 */
export const isoDateToolInputSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha con formato AAAA-MM-DD")
  .describe("Fecha en formato AAAA-MM-DD");
