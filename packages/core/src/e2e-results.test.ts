import { describe, expect, it } from "vitest";
import { deriveE2ECampaignStatus, validateE2ECaseResultEvidence } from "./e2e-results.js";

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
      reason: "Passed E2E case requires strict browser evidence: mode=strict, targetUrl, screenshotPath, and consoleErrors[]."
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
});
