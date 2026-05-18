export type E2ECaseStatus = "created" | "running" | "passed" | "failed" | "blocked" | "skipped";

export type E2ECampaignStatus = E2ECaseStatus;
export type E2ECaseType = "smoke" | "happy_path" | "negative_path" | "persistence";

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
  const hasAcceptedMode = result.mode === "strict" || result.mode === "render-only";
  const hasTargetUrl = typeof result.targetUrl === "string" && result.targetUrl.trim().length > 0;
  const hasScreenshotPath = typeof result.screenshotPath === "string" && result.screenshotPath.trim().length > 0;
  const hasConsoleErrors = Array.isArray(result.consoleErrors);
  if (hasAcceptedMode && hasTargetUrl && hasScreenshotPath && hasConsoleErrors) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "Passed E2E case requires browser evidence: mode=strict or render-only, targetUrl, screenshotPath, and consoleErrors[]."
  };
}

export function shouldAutoRunE2ECase(input: {
  mode: "strict" | "render-only";
  caseType: E2ECaseType;
}): boolean {
  if (input.mode === "render-only") {
    return true;
  }
  return input.caseType === "smoke";
}
