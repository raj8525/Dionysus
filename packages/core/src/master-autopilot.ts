import type { TargetPreflightResult } from "./target-preflight.js";

export type MasterStepAction =
  | "bootstrap_tasks"
  | "skip_fast_lane"
  | "queue_preflight_remediation"
  | "release_queued_integrations"
  | "blocked_dirty_worktree"
  | "ready_for_implementation";

export interface MasterStepDecision {
  action: MasterStepAction;
  reason: string;
}

export function decideMasterStep(input: {
  goalStatus?: string;
  bootstrapTaskCount: number;
  queuedIntegrationCount: number;
  preflight: TargetPreflightResult;
}): MasterStepDecision {
  if (input.goalStatus === "fast_lane") {
    return {
      action: "skip_fast_lane",
      reason: "fast lane goals are driven by Codex-directed worker/reviewer tasks, not by the full Master task tree"
    };
  }

  if (input.bootstrapTaskCount === 0) {
    return {
      action: "bootstrap_tasks",
      reason: "goal has no Master task tree"
    };
  }

  if (input.queuedIntegrationCount > 0 && !input.preflight.git.clean) {
    return {
      action: "blocked_dirty_worktree",
      reason: "queued integrations cannot be released while target worktree is dirty"
    };
  }

  if (input.queuedIntegrationCount > 0) {
    return {
      action: "release_queued_integrations",
      reason: "queued integrations are ready to publish"
    };
  }

  if (input.preflight.gates.some((gate) => gate.status === "blocked")) {
    return {
      action: "queue_preflight_remediation",
      reason: "SDD/TDD evidence is missing"
    };
  }

  return {
    action: "ready_for_implementation",
    reason: "task tree, target git, specs, and tests are ready"
  };
}
