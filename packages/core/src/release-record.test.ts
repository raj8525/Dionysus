import { describe, expect, it } from "vitest";

import {
  deriveGoalStatusAfterRelease,
  validateReleaseRecordCodexOutboxLink,
  validateReleaseRecordEvidence,
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

describe("validateReleaseRecordEvidence", () => {
  it("requires every release record to include a summary for auditability", () => {
    expect(validateReleaseRecordEvidence({
      status: "blocked",
      pushed: false,
      changedFiles: [],
      verification: [],
      summary: ""
    })).toEqual({
      allowed: false,
      reason: "release record requires a non-empty summary"
    });

    expect(validateReleaseRecordEvidence({
      status: "failed",
      pushed: false,
      changedFiles: [],
      verification: [],
      summary: "最终验证失败，保留阻塞原因。"
    })).toEqual({ allowed: true });
  });

  it("requires concrete evidence before a passed pushed release can close a goal", () => {
    expect(validateReleaseRecordEvidence({
      status: "passed",
      pushed: true,
      changedFiles: [],
      verification: [],
      summary: ""
    })).toEqual({
      allowed: false,
      reason: "passed pushed release requires changedFiles, at least one passed verification command, and a non-empty summary"
    });
  });

  it("allows passed pushed releases with changed files, passed verification, and summary", () => {
    expect(validateReleaseRecordEvidence({
      status: "passed",
      pushed: true,
      changedFiles: ["apps/admin-api/internal/handler/example.go"],
      verification: [{ command: "go test ./...", status: "passed" }],
      summary: "已完成并验证。"
    })).toEqual({ allowed: true });
  });

  it("does not require closing evidence for failed or blocked releases", () => {
    expect(validateReleaseRecordEvidence({
      status: "blocked",
      pushed: false,
      changedFiles: [],
      verification: [],
      summary: "等待环境修复。"
    })).toEqual({ allowed: true });
  });
});

describe("validateReleaseRecordCodexOutboxLink", () => {
  it("requires a release record outbox link to point at the same pending release_ready event", () => {
    expect(validateReleaseRecordCodexOutboxLink({
      releaseGoalId: "goal-a",
      outboxEvent: {
        goalId: "goal-a",
        eventType: "release_ready",
        status: "pending"
      }
    })).toEqual({ allowed: true });

    expect(validateReleaseRecordCodexOutboxLink({
      releaseGoalId: "goal-a",
      outboxEvent: {
        goalId: "goal-b",
        eventType: "release_ready",
        status: "pending"
      }
    })).toEqual({
      allowed: false,
      reason: "release record codexOutboxEventId must reference a pending release_ready event for the same goal"
    });

    expect(validateReleaseRecordCodexOutboxLink({
      releaseGoalId: "goal-a",
      outboxEvent: {
        goalId: "goal-a",
        eventType: "blocker",
        status: "pending"
      }
    })).toEqual({
      allowed: false,
      reason: "release record codexOutboxEventId must reference a pending release_ready event for the same goal"
    });

    expect(validateReleaseRecordCodexOutboxLink({
      releaseGoalId: "goal-a",
      outboxEvent: {
        goalId: "goal-a",
        eventType: "release_ready",
        status: "acked"
      }
    })).toEqual({
      allowed: false,
      reason: "release record codexOutboxEventId must reference a pending release_ready event for the same goal"
    });
  });
});
