import { describe, expect, it } from "vitest";
import { deriveE2ECampaignStatus } from "./e2e-results.js";

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
});
