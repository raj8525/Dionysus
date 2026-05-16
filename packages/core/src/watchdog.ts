import type { AgentRole, TaskStatus } from "./types.js";

export interface WatchdogTaskSnapshot {
  id: string;
  goalId: string;
  roleRequired: AgentRole;
  status: TaskStatus;
  currentAttempt: number;
  maxAttempts: number;
  updatedAt: string;
}

export type WatchdogDecision =
  | { action: "ignore"; reason: string }
  | { action: "retry"; reason: string; nextAttempt: number }
  | { action: "block"; reason: string };

export function evaluateWatchdogTask(input: {
  task: WatchdogTaskSnapshot;
  now: Date;
  runningTimeoutMs: number;
}): WatchdogDecision {
  const attemptLimitReached = input.task.currentAttempt >= input.task.maxAttempts;

  if (input.task.status === "failed") {
    if (attemptLimitReached) {
      return { action: "block", reason: "failed task reached max attempts" };
    }
    return {
      action: "retry",
      reason: "failed task can retry",
      nextAttempt: input.task.currentAttempt + 1
    };
  }

  if (input.task.status === "running") {
    const updatedAt = Date.parse(input.task.updatedAt);
    const ageMs = Number.isNaN(updatedAt) ? Number.POSITIVE_INFINITY : input.now.getTime() - updatedAt;
    if (ageMs < input.runningTimeoutMs) {
      return { action: "ignore", reason: "running task is within timeout" };
    }
    if (attemptLimitReached) {
      return { action: "block", reason: "running task timed out and reached max attempts" };
    }
    return {
      action: "retry",
      reason: "running task timed out",
      nextAttempt: input.task.currentAttempt + 1
    };
  }

  return { action: "ignore", reason: `status ${input.task.status} does not need watchdog action` };
}
