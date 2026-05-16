export interface FlowResponse {
  nodes: unknown[];
  edges: unknown[];
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  targetRoot: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalInput {
  title: string;
  description: string;
  targetRoot: string;
}

export interface SystemHealth {
  ok: boolean;
  service: string;
  database: {
    ok: boolean;
    schema: string;
    databaseTime: string;
  };
  rabbitmq: {
    ok: boolean;
    urlConfigured: boolean;
    checkedAt: string;
    error?: string;
  };
  worker: {
    ok: boolean;
    status: string;
    lastEventType?: string;
    lastSeenAt?: string;
    ageSeconds?: number;
    maxAgeSeconds: number;
  };
}

export type AgentRole = "master" | "rule_writer" | "test_writer" | "worker";
export type CliType = "mock" | "claude_code" | "gemini_cli" | "opencode";

export interface AgentCliConfig {
  role: AgentRole;
  cliType: CliType;
  cliModel?: string;
  enabled: boolean;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  status: "idle" | "working" | "blocked" | "disabled";
  cliType: CliType;
  cliModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CliProbeResult {
  cliType: CliType;
  available: boolean;
  command?: string;
  version?: string;
  models?: string[];
  error?: string;
}

export interface CliModelValidationResult {
  cliType: CliType;
  inputModel: string | null;
  resolvedModel: string | null;
  available: boolean;
  command: string;
  reason?: string;
  suggestions?: string[];
}

export interface WatchdogEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  taskId?: string;
  taskTitle?: string;
  roleRequired?: string;
  taskStatus?: string;
  blockedReason?: string;
  goalId?: string;
  scope: "task" | "system";
}

export interface SystemEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WatchdogRunResult {
  checked: number;
  actions: Array<{
    taskId: string;
    roleRequired: string;
    previousStatus: string;
    decision: {
      action: "ignore" | "retry" | "block";
      reason: string;
      nextAttempt?: number;
    };
  }>;
}

export interface TaskRecord {
  id: string;
  goal_id: string;
  title: string;
  description: string;
  role_required: string;
  status: string;
  priority: number;
  blocked_reason?: string;
  current_attempt: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface TaskRunRecord {
  id: string;
  taskId: string;
  goalId: string;
  taskTitle: string;
  roleRequired: string;
  agentId?: string;
  agentName?: string;
  cliType: string;
  cliModel?: string;
  command: string;
  exitCode?: number;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  logPreview: string;
}

export interface TaskRunLogRecord {
  id: string;
  runId: string;
  stream: string;
  chunkText: string;
  sequence: number;
  createdAt: string;
}

export interface TaskRunLogsResponse {
  runId: string;
  logs: TaskRunLogRecord[];
}

export interface AgentCliModelUsage {
  cliType: CliType;
  cliModel: string;
  cliCalls: number;
  modelCalls: number;
  runningCalls: number;
  succeededCalls: number;
  failedCalls: number;
  lastRunAt?: string;
}

export interface AgentCliUsage {
  role: AgentRole;
  cliCalls: number;
  modelCalls: number;
  runningCalls: number;
  succeededCalls: number;
  failedCalls: number;
  lastRunAt?: string;
  models: AgentCliModelUsage[];
}

export interface AgentInstanceCliUsage {
  agentKey: string;
  agentId?: string;
  agentName: string;
  role: AgentRole;
  cliCalls: number;
  modelCalls: number;
  runningCalls: number;
  succeededCalls: number;
  failedCalls: number;
  lastRunAt?: string;
  models: AgentCliModelUsage[];
}

export interface CliUsage {
  cliType: CliType;
  cliCalls: number;
  modelCalls: number;
  runningCalls: number;
  succeededCalls: number;
  failedCalls: number;
  lastRunAt?: string;
}

export interface AgentCliUsageSummary {
  goalId?: string;
  generatedAt: string;
  totals: {
    cliCalls: number;
    modelCalls: number;
    runningCalls: number;
    succeededCalls: number;
    failedCalls: number;
    distinctModels: number;
  };
  byAgent: AgentCliUsage[];
  byAgentInstance: AgentInstanceCliUsage[];
  byCli: CliUsage[];
}

export interface TargetPreflightResult {
  goalId: string;
  status: "passed" | "blocked";
  git: {
    status: "passed" | "blocked";
    clean: boolean;
    changes: string[];
  };
  gates: Array<{
    gateType: string;
    status: "passed" | "blocked";
    required: string[];
    present: string[];
    missing: string[];
  }>;
  blockers: string[];
}

export interface IntegrationRecord {
  id: string;
  patchId: string;
  goalId: string;
  taskId: string;
  status: string;
  patchStatus: string;
  changedFiles: string[];
  result: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseVerificationRecord {
  command: string;
  status: "passed" | "failed" | "blocked";
  output?: string;
}

export interface ReleaseRecord {
  id: string;
  goalId: string;
  codexOutboxEventId?: string;
  targetRoot: string;
  branch: string;
  commitSha: string;
  status: "passed" | "failed" | "blocked";
  pushed: boolean;
  changedFiles: string[];
  verification: ReleaseVerificationRecord[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneRecord {
  id: string;
  goal_id: string;
  name: string;
  description: string;
  status: string;
  candidate_reason?: string;
  codex_verdict?: string;
  codex_verdict_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface E2ECampaignRecord {
  id: string;
  milestone_id: string;
  target_url?: string;
  status: string;
  case_count: number;
  created_at: string;
  updated_at: string;
}

export interface E2ECaseRecord {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  caseType: string;
  preconditions?: string;
  steps: string[];
  expectedResult: string;
  status: string;
  failureReason?: string;
  result: Record<string, unknown>;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseReadyIntegrationsResult {
  goalId: string;
  status: "published" | "blocked";
  published?: number;
  blockers?: string[];
  integrations?: IntegrationRecord[];
  queued?: IntegrationRecord[];
}

export interface MasterStepResult {
  goalId: string;
  decision: {
    action: string;
    reason: string;
  };
  blockers?: string[];
  published?: number;
  integrationPublished?: boolean;
}

const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:23100";

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const response = await fetch(`${apiBase}/health`);
  if (!response.ok) {
    throw new Error(`Failed to load system health: ${response.status}`);
  }
  return (await response.json()) as SystemHealth;
}

export async function fetchCurrentFlow(): Promise<FlowResponse> {
  const response = await fetch(`${apiBase}/api/flow/current`);
  if (!response.ok) {
    throw new Error(`Failed to load flow: ${response.status}`);
  }
  return (await response.json()) as FlowResponse;
}

export async function fetchGoalFlow(goalId: string): Promise<FlowResponse> {
  const response = await fetch(`${apiBase}/api/goals/${encodeURIComponent(goalId)}/graph`);
  if (!response.ok) {
    throw new Error(`Failed to load goal flow: ${response.status}`);
  }
  return (await response.json()) as FlowResponse;
}

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const response = await fetch(`${apiBase}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Failed to create goal: ${response.status}`);
  }
  return (await response.json()) as Goal;
}

export async function fetchGoals(limit = 20): Promise<Goal[]> {
  const response = await fetch(`${apiBase}/api/goals?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    throw new Error(`Failed to load goals: ${response.status}`);
  }
  return (await response.json()) as Goal[];
}

export async function fetchGoal(goalId: string): Promise<Goal> {
  const response = await fetch(`${apiBase}/api/goals/${encodeURIComponent(goalId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load goal: ${response.status}`);
  }
  return (await response.json()) as Goal;
}

export async function fetchAgentCliConfigs(): Promise<AgentCliConfig[]> {
  const response = await fetch(`${apiBase}/api/agent-cli-configs`);
  if (!response.ok) {
    throw new Error(`Failed to load agent CLI configs: ${response.status}`);
  }
  return (await response.json()) as AgentCliConfig[];
}

export async function fetchAgents(): Promise<AgentRecord[]> {
  const response = await fetch(`${apiBase}/api/agents`);
  if (!response.ok) {
    throw new Error(`Failed to load agents: ${response.status}`);
  }
  return (await response.json()) as AgentRecord[];
}

export async function saveAgentCliConfig(input: AgentCliConfig): Promise<AgentCliConfig> {
  const response = await fetch(`${apiBase}/api/agent-cli-configs`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Failed to save agent CLI config: ${response.status}`);
  }
  return (await response.json()) as AgentCliConfig;
}

export async function probeClis(): Promise<CliProbeResult[]> {
  const response = await fetch(`${apiBase}/api/cli/probe`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Failed to probe CLIs: ${response.status}`);
  }
  return (await response.json()) as CliProbeResult[];
}

export async function validateCliModel(input: {
  cliType: CliType;
  model?: string | null;
}): Promise<CliModelValidationResult> {
  const response = await fetch(`${apiBase}/api/cli/validate-model`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Failed to validate CLI model: ${response.status}`);
  }
  return (await response.json()) as CliModelValidationResult;
}

export async function fetchWatchdogEvents(limit = 20): Promise<WatchdogEvent[]> {
  const response = await fetch(`${apiBase}/api/watchdog/events?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to load watchdog events: ${response.status}`);
  }
  return (await response.json()) as WatchdogEvent[];
}

export async function fetchSystemEvents(prefix?: string, limit = 20): Promise<SystemEvent[]> {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  params.set("limit", String(limit));
  const response = await fetch(`${apiBase}/api/system-events?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load system events: ${response.status}`);
  }
  return (await response.json()) as SystemEvent[];
}

export async function fetchTasks(goalId?: string): Promise<TaskRecord[]> {
  const query = goalId ? `?goalId=${goalId}` : "";
  const response = await fetch(`${apiBase}/api/tasks${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load tasks: ${response.status}`);
  }
  return (await response.json()) as TaskRecord[];
}

export async function fetchRuns(goalId?: string, limit = 20): Promise<TaskRunRecord[]> {
  const params = new URLSearchParams();
  if (goalId) params.set("goalId", goalId);
  params.set("limit", String(limit));
  const response = await fetch(`${apiBase}/api/runs?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load runs: ${response.status}`);
  }
  return (await response.json()) as TaskRunRecord[];
}

export async function fetchRunLogs(runId: string): Promise<TaskRunLogsResponse> {
  const response = await fetch(`${apiBase}/api/runs/${encodeURIComponent(runId)}/logs`);
  if (!response.ok) {
    throw new Error(`Failed to load run logs: ${response.status}`);
  }
  return (await response.json()) as TaskRunLogsResponse;
}

export async function fetchAgentCliUsage(goalId?: string): Promise<AgentCliUsageSummary> {
  const params = new URLSearchParams();
  if (goalId) params.set("goalId", goalId);
  const query = params.toString();
  const response = await fetch(`${apiBase}/api/usage/agent-cli${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error(`Failed to load agent CLI usage: ${response.status}`);
  }
  return (await response.json()) as AgentCliUsageSummary;
}

export async function runWatchdog(input = { runningTimeoutMinutes: 15, limit: 50 }): Promise<WatchdogRunResult> {
  const response = await fetch(`${apiBase}/api/watchdog/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Failed to run watchdog: ${response.status}`);
  }
  return (await response.json()) as WatchdogRunResult;
}

export async function runTargetPreflight(goalId: string): Promise<TargetPreflightResult> {
  const response = await fetch(`${apiBase}/api/goals/${goalId}/preflight`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Failed to run target preflight: ${response.status}`);
  }
  return (await response.json()) as TargetPreflightResult;
}

export async function fetchIntegrations(goalId?: string): Promise<IntegrationRecord[]> {
  const query = goalId ? `?goalId=${goalId}` : "";
  const response = await fetch(`${apiBase}/api/integrations${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load integrations: ${response.status}`);
  }
  return (await response.json()) as IntegrationRecord[];
}

export async function fetchReleases(goalId?: string): Promise<ReleaseRecord[]> {
  const query = goalId ? `?goalId=${goalId}` : "";
  const response = await fetch(`${apiBase}/api/releases${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load releases: ${response.status}`);
  }
  return (await response.json()) as ReleaseRecord[];
}

export async function fetchMilestones(goalId?: string): Promise<MilestoneRecord[]> {
  const query = goalId ? `?goalId=${goalId}` : "";
  const response = await fetch(`${apiBase}/api/milestones${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load milestones: ${response.status}`);
  }
  return (await response.json()) as MilestoneRecord[];
}

export async function fetchE2ECampaigns(milestoneId?: string): Promise<E2ECampaignRecord[]> {
  const query = milestoneId ? `?milestoneId=${milestoneId}` : "";
  const response = await fetch(`${apiBase}/api/e2e/campaigns${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load E2E campaigns: ${response.status}`);
  }
  return (await response.json()) as E2ECampaignRecord[];
}

export async function fetchE2ECases(campaignId: string): Promise<E2ECaseRecord[]> {
  const response = await fetch(`${apiBase}/api/e2e/campaigns/${campaignId}/cases`);
  if (!response.ok) {
    throw new Error(`Failed to load E2E cases: ${response.status}`);
  }
  return (await response.json()) as E2ECaseRecord[];
}

export async function releaseReadyIntegrations(goalId: string): Promise<ReleaseReadyIntegrationsResult> {
  const response = await fetch(`${apiBase}/api/goals/${goalId}/integrations/release-ready`, {
    method: "POST"
  });
  const body = (await response.json()) as ReleaseReadyIntegrationsResult;
  if (!response.ok) {
    throw new Error(`Failed to release ready integrations: ${response.status}`);
  }
  return body;
}

export async function runMasterStep(goalId: string): Promise<MasterStepResult> {
  const response = await fetch(`${apiBase}/api/goals/${goalId}/master-step`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Failed to run master step: ${response.status}`);
  }
  return (await response.json()) as MasterStepResult;
}
