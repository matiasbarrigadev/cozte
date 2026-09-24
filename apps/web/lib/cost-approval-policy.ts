import type { Mutation } from "./server/mutations";

/** Only destructive catalog operations need a human decision. */
export function mutationNeedsHumanReview(mutation: Mutation): boolean {
  return mutation.action === "delete-material" || mutation.action === "delete-product";
}
