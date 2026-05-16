import { describe, expect, it } from "vitest";
import { assertGoalTransition, assertMilestoneTransition, assertTaskTransition } from "./state-machine.js";

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
});
