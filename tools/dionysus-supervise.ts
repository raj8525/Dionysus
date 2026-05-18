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
  fastLaneStatus?: unknown;
}

export interface SupervisionStepSummary {
  status: "blocked" | "e2e_required" | "codex_required" | "working";
  shouldContinue: boolean;
  reason: string;
}

export interface FastLaneSupervisionAdvanceDecision {
  shouldAdvance: boolean;
  reason: string;
}

export function buildSupervisionStepRecord(input: {
  iteration: number;
  summary: SupervisionStepSummary;
  agentStatus: Record<string, unknown>;
  runCycle: Record<string, unknown>;
  fastLaneStatus?: unknown;
  fastLaneAdvance?: Record<string, unknown>;
}): Record<string, unknown> {
  const record: Record<string, unknown> = {
    iteration: input.iteration,
    summary: input.summary,
    agentSummary: input.agentStatus.summary,
    agentUsage: input.agentStatus.usage,
    runCycleSummary: input.runCycle.summary
  };
  if (input.fastLaneStatus !== undefined) record.fastLaneStatus = input.fastLaneStatus;
  if (input.fastLaneAdvance) record.fastLaneAdvance = input.fastLaneAdvance;
  return record;
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

  const fastLaneCodexSummary = summarizeFastLaneCodexRequired(input.fastLaneStatus);
  if (fastLaneCodexSummary) return fastLaneCodexSummary;

  if (runCycleSummary.status === "working" && !hasActiveDionysusWork(agentSummary)) {
    return {
      status: "blocked",
      shouldContinue: false,
      reason: `no active Dionysus work: ${String(agentSummary.nextAction ?? "Master must create the next task batch or close the goal")}`
    };
  }

  return {
    status: "working",
    shouldContinue: true,
    reason: "runtime ready; continuing supervision"
  };
}

export function shouldAdvanceFastLaneDuringSupervision(status: { phase?: unknown; nextCommands?: unknown }): FastLaneSupervisionAdvanceDecision {
  const phase = String(status.phase ?? "");
  const nextCommands = Array.isArray(status.nextCommands) ? status.nextCommands.map(String) : [];
  const hasEnqueueCommand = nextCommands.some((command) => command.includes("task enqueue --task-id"));
  if (["ready_for_data_followups", "ready_for_reviewer"].includes(phase) && hasEnqueueCommand) {
    return {
      shouldAdvance: true,
      reason: `fast lane phase ${phase} can safely enqueue next tasks`
    };
  }
  return {
    shouldAdvance: false,
    reason: `fast lane phase ${phase || "unknown"} requires Codex or Agent work before automatic advance`
  };
}

function summarizeFastLaneCodexRequired(status: unknown): SupervisionStepSummary | undefined {
  const fastLaneStatus = nestedRecord(status);
  const phase = String(fastLaneStatus.phase ?? "");
  if (!["reviewer_review", "codex_final"].includes(phase)) return undefined;
  const nextAction = String(fastLaneStatus.nextAction ?? "inspect fast lane status");
  return {
    status: "codex_required",
    shouldContinue: false,
    reason: `fast lane phase ${phase} requires Codex: ${nextAction}`
  };
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstAction(value: unknown): string | undefined {
  return Array.isArray(value) ? value.map(String)[0] : undefined;
}

function hasActiveDionysusWork(agentSummary: Record<string, unknown>): boolean {
  return numeric(agentSummary.queuedTasks) > 0
    || numeric(agentSummary.runningTasks) > 0
    || numeric(agentSummary.runningRuns) > 0
    || numeric(agentSummary.workingAgents) > 0;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
