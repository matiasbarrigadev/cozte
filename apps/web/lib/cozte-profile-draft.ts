import type { ProductionProfile } from "./production-profile";

export type ProductDraftUpdate = {
  name: string;
  finishedUnit?: string;
  goodUnitsPerBatch?: number | null;
  startedUnitsPerBatch?: number | null;
  normalScrapUnitsPerBatch?: number | null;
  batchesPerMonth?: number | null;
  hoursPerBatch?: number | null;
};

/** Merge one product fact into the working map without dropping other products or known fields. */
export function upsertProductDraft(profile: ProductionProfile, update: ProductDraftUpdate): ProductionProfile {
  const key = update.name.trim().toLocaleLowerCase();
  const existingIndex = profile.products.findIndex((product) => product.name.trim().toLocaleLowerCase() === key);
  const existing = existingIndex >= 0 ? profile.products[existingIndex] : null;
  const next = {
    name: existing?.name ?? update.name.trim(),
    finishedUnit: update.finishedUnit ?? existing?.finishedUnit ?? "unidad",
    goodUnitsPerBatch: update.goodUnitsPerBatch !== undefined ? update.goodUnitsPerBatch : existing?.goodUnitsPerBatch ?? null,
    startedUnitsPerBatch: update.startedUnitsPerBatch !== undefined ? update.startedUnitsPerBatch : existing?.startedUnitsPerBatch ?? null,
    normalScrapUnitsPerBatch: update.normalScrapUnitsPerBatch !== undefined ? update.normalScrapUnitsPerBatch : existing?.normalScrapUnitsPerBatch ?? null,
    batchesPerMonth: update.batchesPerMonth !== undefined ? update.batchesPerMonth : existing?.batchesPerMonth ?? null,
    hoursPerBatch: update.hoursPerBatch !== undefined ? update.hoursPerBatch : existing?.hoursPerBatch ?? null,
  };
  const products = [...profile.products];
  if (existingIndex >= 0) products[existingIndex] = next;
  else products.push(next);
  return { ...profile, products };
}
