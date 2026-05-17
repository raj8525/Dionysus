import { describe, expect, it } from "vitest";
import { decideMasterStep } from "./master-autopilot.js";
import type { TargetPreflightResult } from "./target-preflight.js";

describe("master autopilot", () => {
  it("skips full Master task tree for Codex-directed fast lane goals", () => {
    expect(decideMasterStep({
      goalStatus: "fast_lane",
      bootstrapTaskCount: 0,
      queuedIntegrationCount: 0,
      preflight: preflight()
    })).toEqual({
      action: "skip_fast_lane",
      reason: "fast lane goals are driven by Codex-directed worker/reviewer tasks, not by the full Master task tree"
    });
  });

  it("bootstraps task tree before any other work", () => {
    expect(decideMasterStep({ bootstrapTaskCount: 0, queuedIntegrationCount: 0, preflight: preflight() })).toEqual({
      action: "bootstrap_tasks",
      reason: "goal has no Master task tree"
    });
  });

  it("blocks queued integrations while target git worktree is dirty", () => {
    expect(
      decideMasterStep({
        bootstrapTaskCount: 5,
        queuedIntegrationCount: 1,
        preflight: preflight({ clean: false, blockers: ["git worktree dirty: 3 changes"] })
      })
    ).toEqual({
      action: "blocked_dirty_worktree",
      reason: "queued integrations cannot be released while target worktree is dirty"
    });
  });

  it("releases queued integrations when target git worktree is clean", () => {
    expect(
      decideMasterStep({
        bootstrapTaskCount: 5,
        queuedIntegrationCount: 2,
        preflight: preflight()
      }).action
    ).toBe("release_queued_integrations");
  });

  it("queues SDD/TDD remediation when required evidence is missing", () => {
    expect(
      decideMasterStep({
        bootstrapTaskCount: 5,
        queuedIntegrationCount: 0,
        preflight: preflight({ gatesBlocked: true, blockers: ["plan gate blocked: missing docs/PLAN.md"] })
      }).action
    ).toBe("queue_preflight_remediation");
  });

  it("allows implementation only after bootstrap, clean git, no queued integration, and passed gates", () => {
    expect(
      decideMasterStep({
        bootstrapTaskCount: 5,
        queuedIntegrationCount: 0,
        preflight: preflight()
      }).action
    ).toBe("ready_for_implementation");
  });
});

function preflight(input: {
  clean?: boolean;
  gatesBlocked?: boolean;
  blockers?: string[];
} = {}): TargetPreflightResult {
  const clean = input.clean ?? true;
  const gatesBlocked = input.gatesBlocked ?? false;
  return {
    status: clean && !gatesBlocked ? "passed" : "blocked",
    git: {
      status: clean ? "passed" : "blocked",
      clean,
      changes: clean ? [] : [" M app.ts"]
    },
    gates: [
      {
        gateType: "plan",
        status: gatesBlocked ? "blocked" : "passed",
        required: ["docs/PLAN.md"],
        present: gatesBlocked ? [] : ["docs/PLAN.md"],
        missing: gatesBlocked ? ["docs/PLAN.md"] : []
      }
    ],
    blockers: input.blockers ?? []
  };
}
