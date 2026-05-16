export type AgentRole = "master" | "rule_writer" | "test_writer" | "worker";

export type AgentStatus = "idle" | "working" | "blocked" | "disabled";

export type CliType = "mock" | "claude_code" | "gemini_cli" | "opencode";

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
  byCli: CliUsage[];
}

export type GoalStatus =
  | "created"
  | "intake"
  | "planning"
  | "plan_review"
  | "spec_phase"
  | "test_phase"
  | "implementation_phase"
  | "integration_review"
  | "codex_review"
  | "done"
  | "blocked"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "created"
  | "queued"
  | "assigned"
  | "running"
  | "needs_review"
  | "blocked"
  | "failed"
  | "cancelled"
  | "done";

export type MilestoneStatus =
  | "planned"
  | "candidate"
  | "e2e_required"
  | "e2e_running"
  | "e2e_failed"
  | "e2e_blocked"
  | "passed"
  | "notified"
  | "cancelled";

export interface Goal {
  id: string;
  title: string;
  description: string;
  targetRoot: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
