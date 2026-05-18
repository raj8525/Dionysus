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

export function validateE2ECaseResultEvidence(input: {
  status: E2ECaseStatus;
  result?: Record<string, unknown>;
}): {
  allowed: boolean;
  reason?: string;
} {
  if (input.status !== "passed") {
    return { allowed: true };
  }
  const result = input.result ?? {};
  const hasStrictMode = result.mode === "strict";
  const hasTargetUrl = typeof result.targetUrl === "string" && result.targetUrl.trim().length > 0;
  const hasScreenshotPath = typeof result.screenshotPath === "string" && result.screenshotPath.trim().length > 0;
  const hasConsoleErrors = Array.isArray(result.consoleErrors);
  if (hasStrictMode && hasTargetUrl && hasScreenshotPath && hasConsoleErrors) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "Passed E2E case requires strict browser evidence: mode=strict, targetUrl, screenshotPath, and consoleErrors[]."
  };
}
