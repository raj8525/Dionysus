import { describe, expect, it } from "vitest";
import {
  assertGoalTransition,
  assertMilestoneTransition,
  assertTaskTransition,
  deriveTaskStatusAfterRunCompletion,
  taskRunStatusForCodexCompletion
} from "./state-machine.js";

describe("Dionysus state machines", () => {
  it("allows legal task progression", () => {
    expect(() => assertTaskTransition("created", "queued")).not.toThrow();
    expect(() => assertTaskTransition("queued", "assigned")).not.toThrow();
  });

  it("rejects task done without review", () => {
    expect(() => assertTaskTransition("created", "done")).toThrow(/Invalid task transition/);
  });

  it("requires codex_review before goal done", () => {
    expect(() => assertGoalTransition("integration_review", "done")).toThrow(/Invalid goal transition/);
    expect(() => assertGoalTransition("codex_review", "done")).not.toThrow();
  });

  it("requires milestone e2e before passed", () => {
    expect(() => assertMilestoneTransition("candidate", "passed")).toThrow(/Invalid milestone transition/);
    expect(() => assertMilestoneTransition("candidate", "e2e_required")).not.toThrow();
  });

  it("does not resurrect closed or blocked tasks when a late run finishes", () => {
    expect(deriveTaskStatusAfterRunCompletion({
      currentStatus: "cancelled",
      exitCode: 0
    })).toBe("cancelled");
    expect(deriveTaskStatusAfterRunCompletion({
      currentStatus: "done",
      exitCode: 1
    })).toBe("done");
    expect(deriveTaskStatusAfterRunCompletion({
      currentStatus: "blocked",
      exitCode: 0
    })).toBe("blocked");
  });

  it("moves an active running task to review or failed after run completion", () => {
    expect(deriveTaskStatusAfterRunCompletion({
      currentStatus: "running",
      exitCode: 0
    })).toBe("needs_review");
    expect(deriveTaskStatusAfterRunCompletion({
      currentStatus: "running",
      exitCode: 124
    })).toBe("failed");
  });

  it("uses the task_runs completion status vocabulary for Codex handoff", () => {
    expect(taskRunStatusForCodexCompletion()).toBe("succeeded");
  });
});
