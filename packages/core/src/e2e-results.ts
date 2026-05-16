export type E2ECaseStatus = "created" | "running" | "passed" | "failed" | "blocked" | "skipped";

export type E2ECampaignStatus = E2ECaseStatus;

export function deriveE2ECampaignStatus(caseStatuses: E2ECaseStatus[]): E2ECampaignStatus {
  if (caseStatuses.length === 0) return "created";
  if (caseStatuses.includes("blocked")) return "blocked";
  if (caseStatuses.includes("failed")) return "failed";
  if (caseStatuses.includes("running")) return "running";
  if (caseStatuses.includes("created")) return "running";
  return "passed";
}
