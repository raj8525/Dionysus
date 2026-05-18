import { describe, expect, it } from "vitest";

import {
  deriveGoalStatusAfterRelease,
  shouldCloseOutstandingWorkAfterRelease
} from "./release-record.js";

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

describe("shouldCloseOutstandingWorkAfterRelease", () => {
  it("closes residual work when Codex records a pushed passing release", () => {
    expect(shouldCloseOutstandingWorkAfterRelease({
      currentStatus: "fast_lane",
      nextStatus: "done",
      releaseStatus: "passed",
      pushed: true
    })).toBe(true);
  });

  it("also closes residual work when the goal was already done before a release reconcile", () => {
    expect(shouldCloseOutstandingWorkAfterRelease({
      currentStatus: "done",
      nextStatus: null,
      releaseStatus: "passed",
      pushed: true
    })).toBe(true);
  });

  it("does not close residual work for unpushed, failed, or cancelled releases", () => {
    expect(shouldCloseOutstandingWorkAfterRelease({
      currentStatus: "fast_lane",
      nextStatus: null,
      releaseStatus: "passed",
      pushed: false
    })).toBe(false);
    expect(shouldCloseOutstandingWorkAfterRelease({
      currentStatus: "fast_lane",
      nextStatus: "failed",
      releaseStatus: "failed",
      pushed: true
    })).toBe(false);
    expect(shouldCloseOutstandingWorkAfterRelease({
      currentStatus: "cancelled",
      nextStatus: null,
      releaseStatus: "passed",
      pushed: true
    })).toBe(false);
  });
});
