import type { TaskStatus } from "./types.js";

export type TaskReviewVerdict = "approve" | "reject" | "block";
export type TaskReviewNextStatus = Extract<TaskStatus, "done" | "queued" | "blocked">;
export type TaskReviewRejectionPolicyAction = "none" | "retry" | "codex_takeover";

export const DEFAULT_REVIEW_REJECTION_TAKEOVER_THRESHOLD = 10;

export function taskReviewStatusForVerdict(verdict: TaskReviewVerdict): TaskReviewNextStatus {
  const statuses = {
    approve: "done",
    reject: "queued",
    block: "blocked"
  } satisfies Record<TaskReviewVerdict, TaskReviewNextStatus>;
  return statuses[verdict];
}

export function shouldDispatchAfterTaskReview(verdict: TaskReviewVerdict): boolean {
  return verdict === "approve";
}

export function evaluateTaskReviewRejectionPolicy(input: {
  verdict: TaskReviewVerdict;
  rejectionCount: number;
  threshold?: number;
}): {
  action: TaskReviewRejectionPolicyAction;
  threshold: number;
  rejectionCount: number;
  reason?: string;
} {
  const threshold = input.threshold ?? DEFAULT_REVIEW_REJECTION_TAKEOVER_THRESHOLD;
  const rejectionCount = Math.max(0, Math.floor(input.rejectionCount));
  if (input.verdict !== "reject") {
    return { action: "none", threshold, rejectionCount };
  }
  if (rejectionCount >= threshold) {
    return {
      action: "codex_takeover",
      threshold,
      rejectionCount,
      reason: `ReviewerCLI rejected this task ${rejectionCount} times; Codex must take over instead of requeueing WorkerCLI.`
    };
  }
  return { action: "retry", threshold, rejectionCount };
}
