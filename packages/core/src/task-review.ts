import type { TaskStatus } from "./types.js";

export type TaskReviewVerdict = "approve" | "reject" | "block";
export type TaskReviewNextStatus = Extract<TaskStatus, "done" | "queued" | "blocked">;

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
