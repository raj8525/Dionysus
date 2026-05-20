import type { GoalStatus, ReleaseRecordStatus } from "./types.js";

export interface ReleaseVerificationEvidence {
  command: string;
  status: ReleaseRecordStatus;
  output?: string;
}

export function validateReleaseRecordEvidence(input: {
  status: ReleaseRecordStatus;
  pushed: boolean;
  changedFiles: string[];
  verification: ReleaseVerificationEvidence[];
  summary: string;
}): { allowed: true } | { allowed: false; reason: string } {
  const hasSummary = input.summary.trim().length > 0;
  if ((input.status !== "passed" || !input.pushed) && !hasSummary) {
    return {
      allowed: false,
      reason: "release record requires a non-empty summary"
    };
  }

  if (input.status !== "passed" || !input.pushed) {
    return { allowed: true };
  }

  const hasChangedFiles = input.changedFiles.some((file) => file.trim().length > 0);
  const hasPassedVerification = input.verification.some((record) =>
    record.command.trim().length > 0 && record.status === "passed"
  );
  if (!hasChangedFiles || !hasPassedVerification || !hasSummary) {
    return {
      allowed: false,
      reason: "passed pushed release requires changedFiles, at least one passed verification command, and a non-empty summary"
    };
  }

  return { allowed: true };
}

export function validateReleaseRecordCodexOutboxLink(input: {
  releaseGoalId: string;
  outboxEvent: {
    goalId: string;
    eventType: string;
    status: string;
  };
}): { allowed: true } | { allowed: false; reason: string } {
  const valid =
    input.outboxEvent.goalId === input.releaseGoalId &&
    input.outboxEvent.eventType === "release_ready" &&
    input.outboxEvent.status === "pending";
  if (valid) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "release record codexOutboxEventId must reference a pending release_ready event for the same goal"
  };
}

export function deriveGoalStatusAfterRelease(input: {
  currentStatus: GoalStatus;
  releaseStatus: ReleaseRecordStatus;
  pushed: boolean;
}): GoalStatus | null {
  if (input.currentStatus === "done" || input.currentStatus === "failed" || input.currentStatus === "cancelled") {
    return null;
  }

  if (input.releaseStatus === "passed") {
    return input.pushed ? "done" : null;
  }

  if (input.releaseStatus === "failed") {
    return "failed";
  }

  return "blocked";
}

export function shouldCloseOutstandingWorkAfterRelease(input: {
  currentStatus: GoalStatus;
  nextStatus: GoalStatus | null;
  releaseStatus: ReleaseRecordStatus;
  pushed: boolean;
}): boolean {
  if (input.releaseStatus !== "passed" || !input.pushed) {
    return false;
  }

  if (input.currentStatus === "cancelled" || input.currentStatus === "failed") {
    return false;
  }

  return input.currentStatus === "done" || input.nextStatus === "done";
}
