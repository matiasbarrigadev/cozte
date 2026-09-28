import "server-only";
import { z } from "zod";
import { customerKey } from "@/lib/customers";
import { roundMoney } from "@/lib/money";
import { ZONE_MODES, ZONE_MODE_LABELS, matchZone, parseAreas, parseWeekdays, weekdaysFromNames, zoneDeliveryFields, type DeliveryZone, type ZoneMode } from "@/lib/delivery-zones";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery, type SqlStatement } from "./db";
import { resolveSupplier } from "./suppliers";

/**
 * Delivery zones: how each area is delivered, what an order costs there and which days it goes out. Each delivery
 * points to its zone, picked from the customer's address when it is created or its address changes.
 */

type ZoneRowDb = { id: string; name: string; mode: ZoneMode; carrier: string; areas: string; cost_per_order_minor: number; weekdays: string; lead_days: number; is_fallback: number; notes: string };

const ZONE_COLUMNS = "id, name, mode, carrier, areas, cost_per_order_minor, weekdays, lead_days, is_fallback, notes";

const toZone = (row: ZoneRowDb): DeliveryZone => ({
  id: row.id, name: row.name, mode: row.mode, carrier: row.carrier, areas: parseAreas(row.areas), costPerOrderMinor: row.cost_per_order_minor,
  weekdays: parseWeekdays(row.weekdays), leadDays: row.lead_days, isFallback: row.is_fallback === 1, notes: row.notes,
});

const audit = (principal: Principal, action: string, entityId: string, details: unknown): SqlStatement => ({
  sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)",
  params: [crypto.randomUUID(), principal.organizationId, principal.userId, action, entityId, JSON.stringify(details)],
});

function assertEditor(principal: Principal) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar las zonas de entrega");
}

export const zoneInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(2).max(60),
  mode: z.enum(ZONE_MODES as [ZoneMode, ...ZoneMode[]]).default("own"),
  carrier: z.string().trim().max(120).default(""),
  /** A list or a comma separated text. */
  areas: z.union([z.array(z.string().trim().max(60)).max(40), z.string().max(2000)]).default([]),
  costPerOrder: z.number().nonnegative().max(1_000_000_000).default(0),
  /** 1 Monday … 7 Sunday, or their names. */
  weekdays: z.array(z.union([z.number().int().min(1).max(7), z.string().trim().max(12)])).max(7).default([]),
  leadDays: z.number().int().min(0).max(60).default(0),
  isFallback: z.boolean().default(false),
  notes: z.string().trim().max(500).default(""),
});
export type ZoneInput = z.input<typeof zoneInputSchema>;

export async function loadZones(principal: Principal): Promise<DeliveryZone[]> {
  const rows = await dbQuery<ZoneRowDb>(`SELECT ${ZONE_COLUMNS} FROM delivery_zones WHERE organization_id=? AND archived_at IS NULL ORDER BY is_fallback, created_at`, [principal.organizationId]);
  return rows.map(toZone);
}

/** Where customers receive: each active address with its zone, to suggest the zones worth creating. */
export async function loadZonePlaces(principal: Principal): Promise<{ zone: string; address: string }[]> {
  return await dbQuery<{ zone: string; address: string }>("SELECT a.zone, a.address FROM customer_addresses a JOIN customers c ON c.id=a.customer_id WHERE a.organization_id=? AND a.archived_at IS NULL AND c.archived_at IS NULL LIMIT 3000", [principal.organizationId]);
}

/**
 * The zone of a delivery: the one chosen (null for none) or the one its address falls in. Pass the zones when they
 * are already loaded.
 */
export async function deliveryZoneFor(principal: Principal, place: { zoneId?: string | null; zone?: string | null; address?: string | null }, zones?: DeliveryZone[]): Promise<DeliveryZone | null> {
  if (place.zoneId === null) return null;
  const list = zones ?? await loadZones(principal);
  if (place.zoneId) {
    const chosen = list.find((zone) => zone.id === place.zoneId);
    if (!chosen) throw new ApiError(404, "Zona de entrega no encontrada");
    return chosen;
  }
  return matchZone(list, place);
}

/**
 * Creates or changes a zone. The open deliveries that fall in it join it: the ones without a zone (taking its method
 * and carrier when they had none) and the ones the fallback zone was holding (taking its method and carrier). What
 * they cost stays as it was.
 */
export async function saveZone(principal: Principal, input: ZoneInput, source: "user" | "cozte"): Promise<{ id: string; created: boolean; assigned: number; done: string[] }> {
  assertEditor(principal);
  const value = zoneInputSchema.parse(input);
  const org = principal.organizationId;
  const nameKey = customerKey(value.name);
  const zones = await loadZones(principal);
  const current = value.id ? zones.find((zone) => zone.id === value.id) : undefined;
  if (value.id && !current) throw new ApiError(404, "Zona de entrega no encontrada");
  if (zones.some((zone) => zone.id !== value.id && customerKey(zone.name) === nameKey)) throw new ApiError(409, `Ya hay una zona llamada ${value.name}`);
  const areas = typeof value.areas === "string" ? parseAreas(value.areas) : parseAreas(value.areas.join(","));
  const weekdays = weekdaysFromNames(value.weekdays);
  const zone: DeliveryZone = {
    id: value.id ?? crypto.randomUUID(), name: value.name, mode: value.mode, carrier: value.mode === "pickup" ? "" : value.carrier, areas,
    costPerOrderMinor: value.mode === "pickup" ? 0 : roundMoney(value.costPerOrder, (await dbQuery<{ currency: string }>("SELECT currency FROM organizations WHERE id=?", [org]))[0]?.currency), weekdays, leadDays: value.leadDays, isFallback: value.mode !== "pickup" && value.isFallback, notes: value.notes,
  };
  // A carrier zone points to its logistics supplier, found or created by name.
  const supplierId = zone.mode === "carrier" ? await resolveSupplier(principal, zone.carrier, "logistics", source) : null;
  const fields = [zone.name, nameKey, zone.mode, zone.carrier, zone.areas.join(", "), zone.costPerOrderMinor, zone.weekdays.join(","), zone.leadDays, zone.isFallback ? 1 : 0, zone.notes, supplierId];
  const statements: SqlStatement[] = [];
  if (zone.isFallback) statements.push({ sql: "UPDATE delivery_zones SET is_fallback=0 WHERE organization_id=? AND id<>?", params: [org, zone.id] });
  statements.push(current
    ? { sql: "UPDATE delivery_zones SET name=?, name_key=?, mode=?, carrier=?, areas=?, cost_per_order_minor=?, weekdays=?, lead_days=?, is_fallback=?, notes=?, supplier_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [...fields, zone.id, org] }
    : { sql: "INSERT INTO delivery_zones (name, name_key, mode, carrier, areas, cost_per_order_minor, weekdays, lead_days, is_fallback, notes, supplier_id, id, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [...fields, zone.id, org] });
  // Open deliveries without a zone, or held by the fallback zone, that now fall in this one.
  const fallback = zone.isFallback ? null : zones.find((item) => item.isFallback && item.id !== zone.id) ?? null;
  const open = await dbQuery<{ id: string; address: string; zone: string | null; method: string; carrier: string; zone_id: string | null }>(
    `SELECT d.id, d.address, a.zone, d.method, d.carrier, d.zone_id FROM deliveries d LEFT JOIN customer_addresses a ON a.id=d.customer_address_id WHERE d.organization_id=? AND d.archived_at IS NULL AND (d.zone_id IS NULL${fallback ? " OR d.zone_id=?" : ""}) AND d.status IN ('pending', 'on_the_way', 'failed') LIMIT 500`, fallback ? [org, fallback.id] : [org]);
  const next = [...zones.filter((item) => item.id !== zone.id).map((item) => zone.isFallback ? { ...item, isFallback: false } : item), zone];
  const joining = open.filter((row) => matchZone(next, { zone: row.zone, address: row.address })?.id === zone.id);
  const given = zoneDeliveryFields(zone);
  for (const row of joining) {
    const moved = row.zone_id !== null;
    statements.push({ sql: "UPDATE deliveries SET zone_id=?, method=?, carrier=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?", params: [zone.id, moved ? given.method : row.method || given.method, moved ? given.carrier : row.carrier || given.carrier, row.id, org] });
  }
  statements.push(audit(principal, current ? "update-delivery-zone" : "create-delivery-zone", zone.id, { ...value, source }));
  await dbBatch(statements);
  const done = [current ? `Zona actualizada: ${zone.name}` : `Zona creada: ${zone.name} (${ZONE_MODE_LABELS[zone.mode].toLowerCase()})`];
  if (joining.length) done.push(`${joining.length} entrega${joining.length === 1 ? " abierta quedó" : "s abiertas quedaron"} en ${zone.name}`);
  return { id: zone.id, created: !current, assigned: joining.length, done };
}

/** Archives a zone; its open deliveries are left without a zone and the delivered ones keep it as history. */
export async function archiveZone(principal: Principal, id: string): Promise<{ done: string[] }> {
  assertEditor(principal);
  const org = principal.organizationId;
  const [zone] = await dbQuery<{ name: string }>("SELECT name FROM delivery_zones WHERE id=? AND organization_id=? AND archived_at IS NULL", [id, org]);
  if (!zone) throw new ApiError(404, "Zona de entrega no encontrada");
  await dbBatch([
    { sql: "UPDATE delivery_zones SET archived_at=CURRENT_TIMESTAMP, is_fallback=0 WHERE id=? AND organization_id=?", params: [id, org] },
    { sql: "UPDATE deliveries SET zone_id=NULL WHERE organization_id=? AND zone_id=? AND status IN ('pending', 'on_the_way', 'failed')", params: [org, id] },
    audit(principal, "archive-delivery-zone", id, { name: zone.name }),
  ]);
  return { done: [`Zona quitada: ${zone.name}`] };
}
