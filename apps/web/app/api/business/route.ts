import { z } from "zod";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { archiveRecord, channelInputSchema, deliveryInputSchema, loadBusinessView, purchaseInputSchema, recordPurchase, recordSale, saleInputSchema, salePatchSchema, saveChannel, saveDelivery, updateSale } from "@/lib/server/business";

export const runtime = "nodejs";

const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Sales channels, purchases, sales, the company's structure and the month's result. */
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal();
    const requested = new URL(request.url).searchParams.get("month") ?? currentMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) throw new ApiError(400, "Elige un mes válido");
    return Response.json(await loadBusinessView(principal, requested), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-channel"), channel: channelInputSchema }),
  z.object({ action: z.literal("record-purchase"), purchase: purchaseInputSchema, idempotencyKey: z.uuid() }),
  z.object({ action: z.literal("record-sale"), sale: saleInputSchema, idempotencyKey: z.uuid() }),
  z.object({ action: z.literal("update-sale"), id: z.string().min(1).max(120), patch: salePatchSchema }),
  z.object({ action: z.literal("save-delivery"), delivery: deliveryInputSchema }),
  z.object({ action: z.literal("archive"), kind: z.enum(["channel", "purchase", "sale", "delivery"]), id: z.string().min(1).max(120) }),
]);

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const input = actionSchema.parse(await request.json());
    switch (input.action) {
      case "save-channel": return Response.json(await saveChannel(principal, input.channel));
      case "record-purchase": return Response.json(await recordPurchase(principal, input.purchase, { source: "user", idempotencyKey: input.idempotencyKey }), { status: 201 });
      case "record-sale": return Response.json(await recordSale(principal, input.sale, { source: "user", idempotencyKey: input.idempotencyKey }), { status: 201 });
      case "update-sale": return Response.json(await updateSale(principal, input.id, input.patch, "user"));
      case "save-delivery": return Response.json(await saveDelivery(principal, input.delivery, "user"));
      case "archive": await archiveRecord(principal, input.kind, input.id); return Response.json({ ok: true });
    }
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
    return apiFailure(error);
  }
}
