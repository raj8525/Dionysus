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
