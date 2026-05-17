export interface IntegrationMutationEvidence {
  taskId?: string;
  status: string;
  updatedAt: string;
}

export interface TargetMutationHandlingInput {
  currentTaskId: string;
  runStartedAt: string | Date;
  integrations: IntegrationMutationEvidence[];
}

export interface TargetMutationHandlingDecision {
  action: "continue";
  eventType: "target_root_mutation_explained_by_integration" | "target_root_mutation_observed";
  severity: "info" | "warning";
  reason: string;
}

export function targetMutationExplainedByConcurrentIntegration(input: {
  currentTaskId: string;
  runStartedAt: string | Date;
  integrations: IntegrationMutationEvidence[];
}): boolean {
  const runStartedAtMs = new Date(input.runStartedAt).getTime();
  if (!Number.isFinite(runStartedAtMs)) return false;

  return input.integrations.some((integration) => {
    if (integration.status !== "passed") return false;
    if (integration.taskId === input.currentTaskId) return false;
    const updatedAtMs = new Date(integration.updatedAt).getTime();
    return Number.isFinite(updatedAtMs) && updatedAtMs >= runStartedAtMs;
  });
}

export function decideTargetMutationHandling(
  input: TargetMutationHandlingInput
): TargetMutationHandlingDecision {
  if (targetMutationExplainedByConcurrentIntegration(input)) {
    return {
      action: "continue",
      eventType: "target_root_mutation_explained_by_integration",
      severity: "info",
      reason: "target changed while another task integration passed after this run started"
    };
  }

  return {
    action: "continue",
    eventType: "target_root_mutation_observed",
    severity: "warning",
    reason: "target changed during isolated agent run; continue and leave ownership checks to integration and release gates"
  };
}
