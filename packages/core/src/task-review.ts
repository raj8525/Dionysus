import type { TaskStatus } from "./types.js";

export type TaskReviewVerdict = "approve" | "reject" | "block";
export type TaskReviewNextStatus = Extract<TaskStatus, "done" | "queued" | "blocked">;
export type TaskReviewRejectionPolicyAction = "none" | "retry" | "codex_takeover";

export const DEFAULT_REVIEW_REJECTION_TAKEOVER_THRESHOLD = 10;
export const DEFAULT_REVIEWER_APPROVAL_SCORE_THRESHOLD = 90;

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

export function evaluateReviewerApprovalGate(input: {
  taskTitle?: string;
  verdict: TaskReviewVerdict;
  score?: number | null;
  threshold?: number;
}): {
  allowed: boolean;
  threshold: number;
  score?: number;
  reason?: string;
} {
  const threshold = input.threshold ?? DEFAULT_REVIEWER_APPROVAL_SCORE_THRESHOLD;
  const title = input.taskTitle ?? "";
  const isFastLaneReviewer = title.startsWith("FastLane Reviewer");
  if (!isFastLaneReviewer || input.verdict !== "approve") {
    return { allowed: true, threshold, score: normalizeScore(input.score) };
  }

  const score = normalizeScore(input.score);
  if (score === undefined) {
    return {
      allowed: false,
      threshold,
      reason: `FastLane Reviewer approval requires review score >= ${threshold}; score is missing.`
    };
  }

  if (score < threshold) {
    return {
      allowed: false,
      threshold,
      score,
      reason: `FastLane Reviewer score ${score} is below ${threshold}; reject and send concrete fixes back to WorkerCLI.`
    };
  }

  return { allowed: true, threshold, score };
}

function normalizeScore(score: number | null | undefined): number | undefined {
  if (score === null || score === undefined) return undefined;
  if (!Number.isFinite(score)) return undefined;
  return Math.max(0, Math.min(100, Math.floor(score)));
}
