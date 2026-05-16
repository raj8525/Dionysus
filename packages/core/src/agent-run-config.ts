import type { AgentRole, CliType } from "./types.js";
import type { AgentCliConfig } from "./agent-config.js";

export interface AgentRunConfig {
  role: AgentRole;
  cliType: CliType;
  cliModel?: string;
}

export function resolveAgentRunConfig(input: {
  role: AgentRole;
  roleConfig?: AgentCliConfig | null;
  fallback: {
    cliType: CliType;
    cliModel?: string;
  };
}): AgentRunConfig {
  if (input.roleConfig) {
    return {
      role: input.role,
      cliType: input.roleConfig.cliType,
      cliModel: input.roleConfig.cliModel
    };
  }

  return {
    role: input.role,
    cliType: input.fallback.cliType,
    cliModel: input.fallback.cliModel
  };
}
