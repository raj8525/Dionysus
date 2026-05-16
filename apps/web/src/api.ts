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

export type AgentRole = "master" | "rule_writer" | "test_writer" | "worker";
export type CliType = "mock" | "claude_code" | "gemini_cli" | "opencode";

export interface AgentCliConfig {
  role: AgentRole;
  cliType: CliType;
  cliModel?: string;
  enabled: boolean;
}

export interface CliProbeResult {
  cliType: CliType;
  available: boolean;
  version?: string;
  models?: string[];
  error?: string;
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

export async function fetchCurrentFlow(): Promise<FlowResponse> {
  const response = await fetch(`${apiBase}/api/flow/current`);
  if (!response.ok) {
    throw new Error(`Failed to load flow: ${response.status}`);
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

export async function fetchAgentCliConfigs(): Promise<AgentCliConfig[]> {
  const response = await fetch(`${apiBase}/api/agent-cli-configs`);
  if (!response.ok) {
    throw new Error(`Failed to load agent CLI configs: ${response.status}`);
  }
  return (await response.json()) as AgentCliConfig[];
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

export async function fetchWatchdogEvents(limit = 20): Promise<WatchdogEvent[]> {
  const response = await fetch(`${apiBase}/api/watchdog/events?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to load watchdog events: ${response.status}`);
  }
  return (await response.json()) as WatchdogEvent[];
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
