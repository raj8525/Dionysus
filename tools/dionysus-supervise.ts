import { summarizeAgentControlStatus } from "./dionysus-agent-status.js";

export interface SupervisionAgentStatusInput {
  goalId: string;
  health: Record<string, unknown>;
  configs: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  usage: Record<string, unknown>;
}

export interface SupervisionStepInput {
  agentStatus: Record<string, unknown>;
  runCycle: Record<string, unknown>;
}

export interface SupervisionStepSummary {
  status: "blocked" | "e2e_required" | "working";
  shouldContinue: boolean;
  reason: string;
}

export function buildSupervisionStepRecord(input: {
  iteration: number;
  summary: SupervisionStepSummary;
  agentStatus: Record<string, unknown>;
  runCycle: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    iteration: input.iteration,
    summary: input.summary,
    agentSummary: input.agentStatus.summary,
    agentUsage: input.agentStatus.usage,
    runCycleSummary: input.runCycle.summary
  };
}

export function buildSupervisionAgentStatus(input: SupervisionAgentStatusInput): Record<string, unknown> {
  return {
    goalId: input.goalId,
    summary: summarizeAgentControlStatus({
      health: input.health,
      configs: input.configs,
      agents: input.agents,
      tasks: input.tasks,
      runs: input.runs
    }),
    health: input.health,
    configs: input.configs,
    agents: input.agents,
    tasks: input.tasks,
    runs: input.runs,
    usage: input.usage
  };
}

export function summarizeSupervisionStep(input: SupervisionStepInput): SupervisionStepSummary {
  const agentSummary = nestedRecord(input.agentStatus.summary);
  const runCycleSummary = nestedRecord(input.runCycle.summary);

  if (agentSummary.runtime === "blocked") {
    return {
      status: "blocked",
      shouldContinue: false,
      reason: `runtime blocked: ${String(agentSummary.nextAction ?? "run system doctor")}`
    };
  }

  if (runCycleSummary.status === "blocked") {
    return {
      status: "blocked",
      shouldContinue: false,
      reason: `run-cycle blocked: ${firstAction(runCycleSummary.nextActions) ?? "inspect goal status"}`
    };
  }

  if (runCycleSummary.status === "e2e_required") {
    return {
      status: "e2e_required",
      shouldContinue: false,
      reason: `Codex action required: ${firstAction(runCycleSummary.nextActions) ?? "run E2E"}`
    };
  }

  return {
    status: "working",
    shouldContinue: true,
    reason: "runtime ready; continuing supervision"
  };
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstAction(value: unknown): string | undefined {
  return Array.isArray(value) ? value.map(String)[0] : undefined;
}
