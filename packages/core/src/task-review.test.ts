import { describe, expect, it } from "vitest";

import {
  evaluateTaskReviewRejectionPolicy,
  shouldDispatchAfterTaskReview,
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
});
