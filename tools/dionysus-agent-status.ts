export interface AgentControlStatusInput {
  health: Record<string, unknown>;
  configs: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
}

export interface AgentControlStatusSummary {
  runtime: "ready" | "blocked";
  configuredAgents: number;
  disabledAgents: number;
  queuedTasks: number;
  runningTasks: number;
  blockedTasks: number;
  runningRuns: number;
  nextAction: string;
}

export function summarizeAgentControlStatus(input: AgentControlStatusInput): AgentControlStatusSummary {
  const worker = input.health.worker as Record<string, unknown> | undefined;
  const rabbitmq = input.health.rabbitmq as Record<string, unknown> | undefined;
  const database = input.health.database as Record<string, unknown> | undefined;
  const runtimeReady = Boolean(input.health.ok && worker?.ok && rabbitmq?.ok && database?.ok);
  const queuedTasks = countByStatus(input.tasks, "queued");
  const runningTasks = countByStatus(input.tasks, "running");
  const blockedTasks = countByStatus(input.tasks, "blocked");
  const runningRuns = countByStatus(input.runs, "running");

  return {
    runtime: runtimeReady ? "ready" : "blocked",
    configuredAgents: input.configs.filter((config) => config.enabled !== false).length,
    disabledAgents: input.configs.filter((config) => config.enabled === false).length,
    queuedTasks,
    runningTasks,
    blockedTasks,
    runningRuns,
    nextAction: runtimeReady
      ? "继续运行 goal run-cycle 或等待 Worker 消费队列"
      : "先修复 system doctor 中的 PostgreSQL / RabbitMQ / Worker blocker"
  };
}

function countByStatus(records: Array<Record<string, unknown>>, status: string): number {
  return records.filter((record) => record.status === status).length;
}
