import { describe, expect, it } from "vitest";

import {
  evaluateReviewerApprovalGate,
  evaluateTaskReviewRejectionPolicy,
  shouldRequeueRejectedTask,
  shouldDispatchAfterTaskReview,
  taskReviewStatusForContext,
  taskReviewStatusForVerdict
} from "./task-review.js";

describe("taskReviewStatusForVerdict", () => {
  it("maps review verdicts to legal task statuses", () => {
    expect(taskReviewStatusForVerdict("approve")).toBe("done");
    expect(taskReviewStatusForVerdict("reject")).toBe("queued");
    expect(taskReviewStatusForVerdict("block")).toBe("blocked");
  });

  it("dispatches the next task only after approve", () => {
    expect(shouldDispatchAfterTaskReview("approve")).toBe(true);
    expect(shouldDispatchAfterTaskReview("reject")).toBe(false);
    expect(shouldDispatchAfterTaskReview("block")).toBe(false);
  });

  it("blocks rejected FastLane Reviewer tasks instead of requeueing them", () => {
    expect(taskReviewStatusForContext({
      verdict: "reject",
      taskTitle: "FastLane Reviewer 1: D1身份页产品质量门禁"
    })).toBe("blocked");
    expect(shouldRequeueRejectedTask({
      verdict: "reject",
      taskTitle: "FastLane Reviewer 1: D1身份页产品质量门禁"
    })).toBe(false);
  });

  it("keeps ordinary rejected Worker tasks queued for iteration", () => {
    expect(taskReviewStatusForContext({
      verdict: "reject",
      taskTitle: "FastLane Worker 1: 前端实现"
    })).toBe("queued");
    expect(shouldRequeueRejectedTask({
      verdict: "reject",
      taskTitle: "FastLane Worker 1: 前端实现"
    })).toBe(true);
  });

  it("keeps retrying rejected tasks below the Codex takeover threshold", () => {
    expect(evaluateTaskReviewRejectionPolicy({
      verdict: "reject",
      rejectionCount: 9
    })).toEqual({
      action: "retry",
      threshold: 10,
      rejectionCount: 9
    });
  });

  it("requires Codex takeover after ten rejected reviews for the same task", () => {
    expect(evaluateTaskReviewRejectionPolicy({
      verdict: "reject",
      rejectionCount: 10
    })).toEqual({
      action: "codex_takeover",
      threshold: 10,
      rejectionCount: 10,
      reason: "ReviewerCLI rejected this task 10 times; Codex must take over instead of requeueing WorkerCLI."
    });
  });

  it("does not apply the rejection threshold to approve or block verdicts", () => {
    expect(evaluateTaskReviewRejectionPolicy({
      verdict: "approve",
      rejectionCount: 99
    }).action).toBe("none");
    expect(evaluateTaskReviewRejectionPolicy({
      verdict: "block",
      rejectionCount: 99
    }).action).toBe("none");
  });

  it("requires score >= 90 before approving FastLane Reviewer tasks", () => {
    expect(evaluateReviewerApprovalGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      verdict: "approve"
    })).toEqual({
      allowed: false,
      threshold: 90,
      reason: "FastLane Reviewer approval requires review score >= 90; score is missing."
    });

    expect(evaluateReviewerApprovalGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      verdict: "approve",
      score: 89
    })).toEqual({
      allowed: false,
      threshold: 90,
      score: 89,
      reason: "FastLane Reviewer score 89 is below 90; reject and send concrete fixes back to WorkerCLI."
    });

    expect(evaluateReviewerApprovalGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      verdict: "approve",
      score: 90
    })).toEqual({
      allowed: true,
      threshold: 90,
      score: 90
    });
  });

  it("does not require scores for Worker task approval or reviewer rejection", () => {
    expect(evaluateReviewerApprovalGate({
      taskTitle: "FastLane Worker 1: 后端",
      verdict: "approve"
    }).allowed).toBe(true);
    expect(evaluateReviewerApprovalGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      verdict: "reject"
    }).allowed).toBe(true);
  });
});
