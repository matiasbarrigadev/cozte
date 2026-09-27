import { z } from "zod";
import { businessToday } from "@/lib/business";
import { ApiError, apiFailure, requirePrincipal } from "@/lib/server/auth";
import { addressInputSchema, archiveCustomer, archiveCustomerAddress, customerInputSchema, mergeCustomers, saveCustomer, saveCustomerAddress } from "@/lib/server/customers";
import { archiveZone, saveZone, zoneInputSchema } from "@/lib/server/delivery-zones";
import { archiveRecord, channelInputSchema, deliveryInputSchema, loadBusinessView, purchaseInputSchema, purchasePatchSchema, updatePurchase, recordPurchase, recordSale, saleInputSchema, salePatchSchema, saveChannel, saveDelivery, updateSale } from "@/lib/server/business";

export const runtime = "nodejs";

const currentMonth = () => businessToday().slice(0, 7);

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
  z.object({ action: z.literal("update-purchase"), id: z.string().min(1).max(120), patch: purchasePatchSchema }),
  z.object({ action: z.literal("archive"), kind: z.enum(["channel", "purchase", "sale", "delivery"]), id: z.string().min(1).max(120) }),
  z.object({ action: z.literal("save-customer"), customer: customerInputSchema }),
  z.object({ action: z.literal("save-customer-address"), address: addressInputSchema }),
  z.object({ action: z.literal("archive-customer-address"), customerId: z.string().min(1).max(120), id: z.string().min(1).max(120) }),
  z.object({ action: z.literal("merge-customers"), fromId: z.string().min(1).max(120), intoId: z.string().min(1).max(120) }),
  z.object({ action: z.literal("archive-customer"), id: z.string().min(1).max(120) }),
  z.object({ action: z.literal("save-zone"), zone: zoneInputSchema }),
  z.object({ action: z.literal("archive-zone"), id: z.string().min(1).max(120) }),
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
      case "update-purchase": return Response.json(await updatePurchase(principal, input.id, input.patch, "user"));
      case "archive": await archiveRecord(principal, input.kind, input.id); return Response.json({ ok: true });
      case "save-customer": return Response.json(await saveCustomer(principal, input.customer, "user"));
      case "save-customer-address": return Response.json(await saveCustomerAddress(principal, input.address, "user"));
      case "archive-customer-address": await archiveCustomerAddress(principal, input.customerId, input.id); return Response.json({ ok: true });
      case "merge-customers": return Response.json(await mergeCustomers(principal, input.fromId, input.intoId));
      case "archive-customer": await archiveCustomer(principal, input.id); return Response.json({ ok: true });
      case "save-zone": return Response.json(await saveZone(principal, input.zone, "user"));
      case "archive-zone": return Response.json(await archiveZone(principal, input.id));
    }
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
    return apiFailure(error);
  }
}
