import type { CollectionHealth } from "../reporting/status-repository";

export interface CollectionRecovery {
  recovered: true;
  fromStatus: "warning" | "critical";
  fromReason: string;
  toStatus: "healthy";
  toReason: string;
}

export function deriveCollectionRecovery(
  before: CollectionHealth,
  after: CollectionHealth,
): CollectionRecovery | null {
  if (after.status !== "healthy") return null;
  if (before.status !== "warning" && before.status !== "critical") return null;
  return {
    recovered: true,
    fromStatus: before.status,
    fromReason: before.reason,
    toStatus: "healthy",
    toReason: after.reason,
  };
}
