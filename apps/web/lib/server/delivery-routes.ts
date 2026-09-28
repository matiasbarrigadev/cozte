import "server-only";
import { z } from "zod";
import { ApiError, type Principal } from "./auth";
import { dbBatch, dbQuery, type SqlStatement } from "./db";

/** Route sheets: the order of each day's stops, kept on the deliveries, and where the routes start from. */

function assertEditor(principal: Principal) {
  if (principal.role === "viewer") throw new ApiError(403, "No tienes permiso para cambiar las rutas");
}

export const routeOrderSchema = z.array(z.string().min(1).max(120)).min(1).max(200);

/** Saves a route's order: each delivery takes its place in the list. */
export async function saveRouteOrder(principal: Principal, ids: string[], source: "user" | "cozte"): Promise<{ done: string[] }> {
  assertEditor(principal);
  const list = routeOrderSchema.parse(ids);
  const org = principal.organizationId;
  const statements: SqlStatement[] = list.map((id, index) => ({ sql: "UPDATE deliveries SET route_position=? WHERE id=? AND organization_id=? AND archived_at IS NULL", params: [index, id, org] }));
  statements.push({ sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), org, principal.userId, "save-route-order", list[0], JSON.stringify({ ids: list, source })] });
  await dbBatch(statements);
  return { done: [`Orden de la ruta guardado (${list.length} parada${list.length === 1 ? "" : "s"})`] };
}

export async function loadRouteOrigin(principal: Principal): Promise<string> {
  const [row] = await dbQuery<{ route_origin: string | null }>("SELECT route_origin FROM organizations WHERE id=?", [principal.organizationId]);
  return row?.route_origin ?? "";
}

/** Where the routes start from; empty means from wherever the driver opens the map. */
export async function saveRouteOrigin(principal: Principal, origin: string): Promise<{ done: string[] }> {
  assertEditor(principal);
  const value = z.string().trim().max(200).parse(origin);
  await dbBatch([{ sql: "UPDATE organizations SET route_origin=? WHERE id=?", params: [value, principal.organizationId] }]);
  return { done: [value ? `Las rutas salen desde ${value}` : "Las rutas salen desde donde esté el repartidor"] };
}
