import "server-only";
import { ApiError, type Principal } from "./auth";
import { dbBatch } from "./db";

export async function reserveAssistantRequest(principal: Principal) {
  const now = new Date().toISOString();
  const buckets = [`minute:${now.slice(0, 16)}`, `day:${now.slice(0, 10)}`];
  try {
    await dbBatch(buckets.map((bucket) => ({ sql: "INSERT INTO assistant_request_limits (organization_id, user_id, bucket, requests) VALUES (?, ?, ?, 1) ON CONFLICT (organization_id, user_id, bucket) DO UPDATE SET requests=requests+1", params: [principal.organizationId, principal.userId, bucket] })));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new ApiError(429, "Llegaste al límite temporal de consultas a Cozte. Vuelve a intentar más tarde");
    throw error;
  }
}
