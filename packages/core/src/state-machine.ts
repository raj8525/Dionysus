import type { GoalStatus, MilestoneStatus, TaskStatus } from "./types.js";

const terminalStates = new Set(["done", "failed", "cancelled"]);

const goalTransitions: Record<GoalStatus, GoalStatus[]> = {
  created: ["intake", "blocked", "cancelled"],
  intake: ["planning", "blocked", "failed", "cancelled"],
  planning: ["plan_review", "blocked", "failed", "cancelled"],
  plan_review: ["spec_phase", "planning", "blocked", "failed", "cancelled"],
  spec_phase: ["test_phase", "blocked", "failed", "cancelled"],
  test_phase: ["implementation_phase", "blocked", "failed", "cancelled"],
  implementation_phase: ["integration_review", "blocked", "failed", "cancelled"],
  integration_review: ["codex_review", "implementation_phase", "blocked", "failed", "cancelled"],
  codex_review: ["done", "implementation_phase", "blocked", "failed", "cancelled"],
  done: [],
  blocked: ["planning", "spec_phase", "test_phase", "implementation_phase", "cancelled"],
  failed: [],
  cancelled: []
};

const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  created: ["queued", "blocked", "cancelled"],
  queued: ["assigned", "blocked", "cancelled"],
  assigned: ["running", "blocked", "cancelled"],
  running: ["needs_review", "blocked", "failed", "cancelled"],
  needs_review: ["done", "queued", "blocked", "failed", "cancelled"],
  blocked: ["queued", "cancelled"],
  failed: ["queued", "cancelled"],
  cancelled: [],
  done: []
};

const milestoneTransitions: Record<MilestoneStatus, MilestoneStatus[]> = {
  planned: ["candidate", "cancelled"],
  candidate: ["e2e_required", "cancelled"],
  e2e_required: ["e2e_running", "e2e_blocked", "cancelled"],
  e2e_running: ["passed", "e2e_failed", "e2e_blocked", "cancelled"],
  e2e_failed: ["e2e_required", "cancelled"],
  e2e_blocked: ["e2e_required", "cancelled"],
  passed: ["notified"],
  notified: [],
  cancelled: []
};

export function canTransition<T extends string>(
  transitions: Record<T, T[]>,
  from: T,
  to: T
): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertGoalTransition(from: GoalStatus, to: GoalStatus): void {
  assertTransition("goal", goalTransitions, from, to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  assertTransition("task", taskTransitions, from, to);
}

export function assertMilestoneTransition(from: MilestoneStatus, to: MilestoneStatus): void {
  assertTransition("milestone", milestoneTransitions, from, to);
}

export function isTerminalStatus(status: string): boolean {
  return terminalStates.has(status);
}

function assertTransition<T extends string>(
  entity: string,
  transitions: Record<T, T[]>,
  from: T,
  to: T
): void {
  if (!canTransition(transitions, from, to)) {
    throw new Error(`Invalid ${entity} transition: ${from} -> ${to}`);
  }
}
