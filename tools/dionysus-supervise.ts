export interface SupervisionStepInput {
  agentStatus: Record<string, unknown>;
  runCycle: Record<string, unknown>;
}

export interface SupervisionStepSummary {
  status: "blocked" | "e2e_required" | "working";
  shouldContinue: boolean;
  reason: string;
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
