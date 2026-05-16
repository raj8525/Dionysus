import type { AgentRole, CliType } from "./types.js";

export interface AgentCliConfig {
  role: AgentRole;
  cliType: CliType;
  cliModel?: string;
}

export function normalizeAgentCliConfig(input: {
  role: AgentRole;
  cliType?: string | null;
  cliModel?: string | null;
}): AgentCliConfig {
  return {
    role: input.role,
    cliType: isCliType(input.cliType) ? input.cliType : "mock",
    cliModel: input.cliModel || undefined
  };
}

export function isCliType(value: string | null | undefined): value is CliType {
  return value === "mock" || value === "claude_code" || value === "gemini_cli" || value === "opencode";
}
