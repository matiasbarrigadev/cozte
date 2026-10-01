import "server-only";
import type { Principal } from "./auth";
import { loadDashboard } from "./state";
import { loadJourney } from "./journey";

/** Everything the workspace opens with: the costs and records, and the company's discovery path. */
export async function loadWorkspace(principal: Principal) {
  const dashboard = await loadDashboard(principal);
  const journey = await loadJourney(principal, dashboard, { persist: true });
  return { ...dashboard, journey };
}
