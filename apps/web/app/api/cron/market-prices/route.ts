import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshMarketPrices } from "@/lib/server/market-prices";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Once a day: the market prices that are due for their monthly update are searched again. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!process.env.FIRECRAWL_API_KEY) return NextResponse.json({ ok: true, skipped: "La búsqueda web no está configurada" });
  try {
    return NextResponse.json({ ok: true, ...(await refreshMarketPrices()), checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Market price job failed", error);
    return NextResponse.json({ error: "No se pudieron actualizar los precios de mercado" }, { status: 500 });
  }
}
