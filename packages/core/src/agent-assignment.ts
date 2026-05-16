import type { AgentRecord, AgentRole } from "./types.js";

export function selectAgentForRun(input: {
  role: AgentRole;
  agents: AgentRecord[];
}): AgentRecord | null {
  const candidates = input.agents
    .filter((agent) => agent.role === input.role && agent.status !== "disabled")
    .sort(compareAgentsForRun);

  return candidates[0] ?? null;
}

function compareAgentsForRun(left: AgentRecord, right: AgentRecord): number {
  const statusDiff = agentStatusRank(left.status) - agentStatusRank(right.status);
  if (statusDiff !== 0) return statusDiff;
  const updatedDiff = new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
  if (updatedDiff !== 0) return updatedDiff;
  return left.name.localeCompare(right.name);
}

function agentStatusRank(status: AgentRecord["status"]): number {
  if (status === "idle") return 0;
  if (status === "blocked") return 1;
  return 2;
}
