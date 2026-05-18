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
  if (input.status !== "passed" || !input.pushed) {
    return { allowed: true };
  }

  const hasChangedFiles = input.changedFiles.some((file) => file.trim().length > 0);
  const hasPassedVerification = input.verification.some((record) =>
    record.command.trim().length > 0 && record.status === "passed"
  );
  const hasSummary = input.summary.trim().length > 0;
  if (!hasChangedFiles || !hasPassedVerification || !hasSummary) {
    return {
      allowed: false,
      reason: "passed pushed release requires changedFiles, at least one passed verification command, and a non-empty summary"
    };
  }

  return { allowed: true };
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
