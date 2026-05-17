import { describe, expect, it } from "vitest";

import { deriveGoalStatusAfterRelease } from "./release-record.js";

describe("deriveGoalStatusAfterRelease", () => {
  it("closes fast lane goals when Codex records a pushed passing release", () => {
    expect(deriveGoalStatusAfterRelease({
      currentStatus: "fast_lane",
      releaseStatus: "passed",
      pushed: true
    })).toBe("done");
  });

  it("does not close a goal when the passing release has not been pushed", () => {
    expect(deriveGoalStatusAfterRelease({
      currentStatus: "fast_lane",
      releaseStatus: "passed",
      pushed: false
    })).toBeNull();
  });

  it("propagates failed and blocked release outcomes to active goals", () => {
    expect(deriveGoalStatusAfterRelease({
      currentStatus: "codex_review",
      releaseStatus: "failed",
      pushed: false
    })).toBe("failed");

    expect(deriveGoalStatusAfterRelease({
      currentStatus: "codex_review",
      releaseStatus: "blocked",
      pushed: false
    })).toBe("blocked");
  });

  it("does not reopen terminal goals", () => {
    expect(deriveGoalStatusAfterRelease({
      currentStatus: "cancelled",
      releaseStatus: "passed",
      pushed: true
    })).toBeNull();
  });
});
