import type { AgentCliUsageSummary, AgentInstanceCliUsage, AgentRole, CliType } from "./types.js";

export interface AgentCliUsageRow {
  role: AgentRole;
  agentId?: string | null;
  agentName?: string | null;
  cliType: CliType;
  cliModel?: string | null;
  status: string;
  cliCalls?: number;
  modelCalls?: number | null;
  runAt?: string | null;
}

export function buildAgentCliUsageSummary(input: {
  goalId?: string;
  generatedAt?: string;
  rows: AgentCliUsageRow[];
}): AgentCliUsageSummary {
  const byAgent = new Map<AgentRole, AgentCliUsageSummary["byAgent"][number]>();
  const byAgentInstance = new Map<string, AgentInstanceCliUsage>();
  const byCli = new Map<CliType, AgentCliUsageSummary["byCli"][number]>();
  const distinctModels = new Set<string>();
  const totals = {
    cliCalls: 0,
    modelCalls: 0,
    runningCalls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    distinctModels: 0
  };

  for (const row of input.rows) {
    const cliModel = normalizeModel(row.cliModel);
    const cliCalls = Math.max(row.cliCalls ?? 1, 0);
    const modelCalls = row.cliType === "mock" ? 0 : Math.max(row.modelCalls ?? cliCalls, 0);
    const runningCalls = row.status === "running" ? cliCalls : 0;
    const succeededCalls = row.status === "succeeded" ? cliCalls : 0;
    const failedCalls = row.status === "failed" ? cliCalls : 0;
    const lastRunAt = row.runAt ?? undefined;

    totals.cliCalls += cliCalls;
    totals.modelCalls += modelCalls;
    totals.runningCalls += runningCalls;
    totals.succeededCalls += succeededCalls;
    totals.failedCalls += failedCalls;
    if (modelCalls > 0) {
      distinctModels.add(`${row.cliType}:${cliModel}`);
    }

    upsertRoleUsage(byAgent, row.role, {
      cliType: row.cliType,
      cliModel,
      cliCalls,
      modelCalls,
      runningCalls,
      succeededCalls,
      failedCalls,
      lastRunAt
    });

    upsertAgentInstanceUsage(byAgentInstance, row, {
      cliModel,
      cliCalls,
      modelCalls,
      runningCalls,
      succeededCalls,
      failedCalls,
      lastRunAt
    });

    upsertCliUsage(byCli, row.cliType, {
      cliCalls,
      modelCalls,
      runningCalls,
      succeededCalls,
      failedCalls,
      lastRunAt
    });
  }

  totals.distinctModels = distinctModels.size;

  return {
    goalId: input.goalId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals,
    byAgent: Array.from(byAgent.values()).sort((left, right) => roleSort(left.role) - roleSort(right.role)),
    byAgentInstance: Array.from(byAgentInstance.values()).sort((left, right) => {
      const roleDiff = roleSort(left.role) - roleSort(right.role);
      if (roleDiff !== 0) return roleDiff;
      return left.agentName.localeCompare(right.agentName);
    }),
    byCli: Array.from(byCli.values()).sort((left, right) => left.cliType.localeCompare(right.cliType))
  };
}

function upsertRoleUsage(
  byAgent: Map<AgentRole, AgentCliUsageSummary["byAgent"][number]>,
  role: AgentRole,
  modelUsage: AgentCliUsageSummary["byAgent"][number]["models"][number]
): void {
  const usage = byAgent.get(role) ?? {
    role,
    cliCalls: 0,
    modelCalls: 0,
    runningCalls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    lastRunAt: undefined,
    models: []
  };
  addCounters(usage, modelUsage);
  mergeModelUsage(usage.models, modelUsage);
  byAgent.set(role, usage);
}

function upsertAgentInstanceUsage(
  byAgentInstance: Map<string, AgentInstanceCliUsage>,
  row: AgentCliUsageRow,
  modelUsage: Omit<AgentCliUsageSummary["byAgent"][number]["models"][number], "cliType"> & { cliModel: string }
): void {
  const agentKey = row.agentId ? `agent:${row.agentId}` : `role:${row.role}`;
  const usage = byAgentInstance.get(agentKey) ?? {
    agentKey,
    agentId: row.agentId ?? undefined,
    agentName: row.agentName?.trim() || roleLabel(row.role),
    role: row.role,
    cliCalls: 0,
    modelCalls: 0,
    runningCalls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    lastRunAt: undefined,
    models: []
  };
  addCounters(usage, modelUsage);
  mergeModelUsage(usage.models, { ...modelUsage, cliType: row.cliType });
  byAgentInstance.set(agentKey, usage);
}

function upsertCliUsage(
  byCli: Map<CliType, AgentCliUsageSummary["byCli"][number]>,
  cliType: CliType,
  counters: Pick<AgentCliUsageSummary["byCli"][number], "cliCalls" | "modelCalls" | "runningCalls" | "succeededCalls" | "failedCalls" | "lastRunAt">
): void {
  const usage = byCli.get(cliType) ?? {
    cliType,
    cliCalls: 0,
    modelCalls: 0,
    runningCalls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    lastRunAt: undefined
  };
  addCounters(usage, counters);
  byCli.set(cliType, usage);
}

function mergeModelUsage(
  models: AgentCliUsageSummary["byAgent"][number]["models"],
  next: AgentCliUsageSummary["byAgent"][number]["models"][number]
): void {
  const existing = models.find((model) => model.cliType === next.cliType && model.cliModel === next.cliModel);
  if (!existing) {
    models.push({ ...next });
    return;
  }
  addCounters(existing, next);
}

function addCounters(
  target: Pick<AgentCliUsageSummary["byCli"][number], "cliCalls" | "modelCalls" | "runningCalls" | "succeededCalls" | "failedCalls" | "lastRunAt">,
  next: Pick<AgentCliUsageSummary["byCli"][number], "cliCalls" | "modelCalls" | "runningCalls" | "succeededCalls" | "failedCalls" | "lastRunAt">
): void {
  target.cliCalls += next.cliCalls;
  target.modelCalls += next.modelCalls;
  target.runningCalls += next.runningCalls;
  target.succeededCalls += next.succeededCalls;
  target.failedCalls += next.failedCalls;
  target.lastRunAt = latestIso(target.lastRunAt, next.lastRunAt);
}

function normalizeModel(value?: string | null): string {
  return value?.trim() || "default/unknown";
}

function latestIso(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function roleSort(role: AgentRole): number {
  return ["master", "rule_writer", "test_writer", "worker"].indexOf(role);
}

function roleLabel(role: AgentRole): string {
  return {
    master: "Master",
    rule_writer: "RuleWriter",
    test_writer: "TestWriter",
    worker: "Worker"
  }[role];
}
