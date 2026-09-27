import "server-only";
import { buildBusinessView } from "@/lib/business";
import { monthsBack, summarizeMonth, type BusinessAnalysis } from "@/lib/business-analytics";
import type { Principal } from "./auth";
import { loadBusinessRecords, organizationToday } from "./business";
import { loadState } from "./state";

/** Each month's records summarized by the same engine the sections use; months are loaded in parallel. */
export async function loadBusinessAnalysis(principal: Principal, count: number): Promise<BusinessAnalysis> {
  const [state, today] = await Promise.all([loadState(principal), organizationToday(principal)]);
  const months = monthsBack(today.slice(0, 7), count);
  const records = await Promise.all(months.map((month) => loadBusinessRecords(principal, month)));
  return {
    currency: state.organization.currency,
    today,
    months: months.map((month, index) => summarizeMonth(buildBusinessView(state, records[index], month), month, today)),
  };
}
