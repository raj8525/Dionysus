import { describe, expect, it } from "vitest";
import { evaluateWatchdogTask, type WatchdogTaskSnapshot } from "./watchdog.js";

function task(patch: Partial<WatchdogTaskSnapshot>): WatchdogTaskSnapshot {
  return {
    id: "task-1",
    goalId: "goal-1",
    roleRequired: "worker",
    status: "running",
    currentAttempt: 1,
    maxAttempts: 3,
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...patch
  };
}

describe("watchdog decisions", () => {
  const now = new Date("2026-05-16T00:30:00.000Z");

  it("retries stale running tasks while attempts remain", () => {
    expect(evaluateWatchdogTask({
      task: task({ status: "running", currentAttempt: 1 }),
      now,
      runningTimeoutMs: 10 * 60 * 1000
    })).toEqual({
      action: "retry",
      reason: "running task timed out",
      nextAttempt: 2
    });
  });

  it("blocks stale running tasks after max attempts", () => {
    expect(evaluateWatchdogTask({
      task: task({ status: "running", currentAttempt: 3, maxAttempts: 3 }),
      now,
      runningTimeoutMs: 10 * 60 * 1000
    })).toEqual({
      action: "block",
      reason: "running task timed out and reached max attempts"
    });
  });

  it("retries failed tasks until max attempts", () => {
    expect(evaluateWatchdogTask({
      task: task({ status: "failed", currentAttempt: 1 }),
      now,
      runningTimeoutMs: 10 * 60 * 1000
    })).toMatchObject({
      action: "retry",
      nextAttempt: 2
    });
  });

  it("ignores fresh running tasks", () => {
    expect(evaluateWatchdogTask({
      task: task({ status: "running", updatedAt: "2026-05-16T00:29:00.000Z" }),
      now,
      runningTimeoutMs: 10 * 60 * 1000
    })).toEqual({
      action: "ignore",
      reason: "running task is within timeout"
    });
  });
});
