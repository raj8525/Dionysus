import type { AgentRole, CliType } from "@dionysus/core";

export interface CliModelValidationResult {
  cliType: CliType;
  inputModel: string | null;
  resolvedModel: string | null;
  available: boolean;
  command: string;
  reason?: string;
  suggestions?: string[];
}

export interface AgentConfigInput {
  role: AgentRole;
  cliType: CliType;
  cliModel?: string;
  enabled: boolean;
  validation?: CliModelValidationResult;
}

export interface AgentConfigSavePlan {
  role: AgentRole;
  cliType: CliType;
  cliModel?: string;
  enabled: boolean;
}

export function buildAgentConfigSavePlan(input: AgentConfigInput): AgentConfigSavePlan {
  if (input.cliType === "mock") {
    return {
      role: input.role,
      cliType: input.cliType,
      enabled: input.enabled
    };
  }

  if (input.validation && !input.validation.available) {
    throw new Error(`model not available: ${input.validation.reason ?? input.validation.resolvedModel ?? input.cliModel ?? input.cliType}`);
  }

  return {
    role: input.role,
    cliType: input.cliType,
    cliModel: input.validation?.resolvedModel ?? input.cliModel,
    enabled: input.enabled
  };
}
