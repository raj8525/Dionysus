import type { GoalStatus, ReleaseRecordStatus } from "./types.js";

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
