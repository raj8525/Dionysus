import { describe, expect, it } from "vitest";
import { deriveE2ECampaignStatus, shouldAutoRunE2ECase, validateE2ECaseResultEvidence } from "./e2e-results.js";

describe("E2E result aggregation", () => {
  it("marks campaign passed only when every case is passed or skipped", () => {
    expect(deriveE2ECampaignStatus(["passed", "passed", "skipped"])).toBe("passed");
    expect(deriveE2ECampaignStatus(["passed", "created"])).toBe("running");
    expect(deriveE2ECampaignStatus(["passed", "failed"])).toBe("failed");
    expect(deriveE2ECampaignStatus(["passed", "blocked"])).toBe("blocked");
  });

  it("keeps empty campaigns in created status", () => {
    expect(deriveE2ECampaignStatus([])).toBe("created");
  });

  it("requires concrete browser evidence before marking an E2E case passed", () => {
    expect(validateE2ECaseResultEvidence({
      status: "passed",
      result: { note: "checked manually" }
    })).toEqual({
      allowed: false,
      reason: "Passed E2E case requires browser evidence: mode=strict or render-only, targetUrl, screenshotPath, and consoleErrors[]."
    });

    expect(validateE2ECaseResultEvidence({
      status: "passed",
      result: {
        mode: "strict",
        targetUrl: "http://127.0.0.1:5173",
        screenshotPath: "/tmp/e2e.png",
        consoleErrors: []
      }
    })).toEqual({ allowed: true });
  });

  it("allows render-only passed cases as diagnostic browser evidence", () => {
    expect(validateE2ECaseResultEvidence({
      status: "passed",
      result: {
        mode: "render-only",
        targetUrl: "http://127.0.0.1:5173",
        screenshotPath: "/tmp/render-only.png",
        consoleErrors: []
      }
    })).toEqual({ allowed: true });
  });

  it("auto-runs only smoke cases in strict mode", () => {
    expect(shouldAutoRunE2ECase({ mode: "strict", caseType: "smoke" })).toBe(true);
    expect(shouldAutoRunE2ECase({ mode: "strict", caseType: "happy_path" })).toBe(false);
    expect(shouldAutoRunE2ECase({ mode: "strict", caseType: "negative_path" })).toBe(false);
    expect(shouldAutoRunE2ECase({ mode: "strict", caseType: "persistence" })).toBe(false);
  });
});
