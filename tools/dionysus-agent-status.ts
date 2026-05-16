export interface AgentControlStatusInput {
  health: Record<string, unknown>;
  configs: Array<Record<string, unknown>>;
  agents?: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
}

export interface AgentControlStatusSummary {
  runtime: "ready" | "blocked";
  configuredAgents: number;
  disabledAgents: number;
  agentInstances: number;
  idleAgents: number;
  workingAgents: number;
  blockedAgentInstances: number;
  disabledAgentInstances: number;
  queuedTasks: number;
  runningTasks: number;
  blockedTasks: number;
  runningRuns: number;
  boundRecentRuns: number;
  unboundRecentRuns: number;
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
  const agents = input.agents ?? [];
  const idleAgents = countByStatus(agents, "idle");
  const workingAgents = countByStatus(agents, "working");
  const blockedAgentInstances = countByStatus(agents, "blocked");
  const disabledAgentInstances = countByStatus(agents, "disabled");
  const unboundRecentRuns = input.runs.filter((run) => !run.agentId && !run.agent_id).length;
  const boundRecentRuns = input.runs.length - unboundRecentRuns;
  const inconsistentRuntime = runtimeReady && runningRuns > 0 && (workingAgents === 0 || unboundRecentRuns > 0);

  return {
    runtime: runtimeReady && !inconsistentRuntime ? "ready" : "blocked",
    configuredAgents: input.configs.filter((config) => config.enabled !== false).length,
    disabledAgents: input.configs.filter((config) => config.enabled === false).length,
    agentInstances: agents.length,
    idleAgents,
    workingAgents,
    blockedAgentInstances,
    disabledAgentInstances,
    queuedTasks,
    runningTasks,
    blockedTasks,
    runningRuns,
    boundRecentRuns,
    unboundRecentRuns,
    nextAction: nextAction({
      runtimeReady,
      inconsistentRuntime,
      queuedTasks,
      runningRuns,
      workingAgents,
      unboundRecentRuns
    })
  };
}

function countByStatus(records: Array<Record<string, unknown>>, status: string): number {
  return records.filter((record) => record.status === status).length;
}

function nextAction(input: {
  runtimeReady: boolean;
  inconsistentRuntime: boolean;
  queuedTasks: number;
  runningRuns: number;
  workingAgents: number;
  unboundRecentRuns: number;
}): string {
  if (!input.runtimeReady) {
    return "先修复 system doctor 中的 PostgreSQL / RabbitMQ / Worker blocker";
  }
  if (input.inconsistentRuntime) {
    if (input.unboundRecentRuns > 0) {
      return "存在 running run 未绑定具体 Agent，先检查 Runtime 版本与 task_runs.agent_id";
    }
    return "存在 running run 但没有 working Agent，先检查 Agent release/claim 状态";
  }
  if (input.queuedTasks > 0 && input.workingAgents === 0) {
    return "有 queued task 但暂无 working Agent，确认 Worker Runtime 是否正在消费队列";
  }
  return "继续运行 goal run-cycle 或等待 Worker 消费队列";
}
