import type { AgentCliConfig, CliModelValidationResult, CliType } from "./api.js";

export class AgentConfigValidationError extends Error {
  constructor(
    message: string,
    readonly validation: CliModelValidationResult
  ) {
    super(message);
    this.name = "AgentConfigValidationError";
  }
}

export async function saveValidatedAgentCliConfig(
  config: AgentCliConfig,
  dependencies: {
    validate: (input: { cliType: CliType; model?: string | null }) => Promise<CliModelValidationResult>;
    save: (input: AgentCliConfig) => Promise<AgentCliConfig>;
  }
): Promise<{ saved: AgentCliConfig; validation?: CliModelValidationResult }> {
  if (config.cliType !== "opencode") {
    return { saved: await dependencies.save(config) };
  }

  const validation = await dependencies.validate({
    cliType: config.cliType,
    model: config.cliModel ?? null
  });

  if (!validation.available) {
    throw new AgentConfigValidationError(buildValidationErrorMessage(validation), validation);
  }

  const normalizedConfig: AgentCliConfig = {
    ...config,
    cliModel: validation.resolvedModel ?? config.cliModel
  };

  return {
    saved: await dependencies.save(normalizedConfig),
    validation
  };
}

function buildValidationErrorMessage(validation: CliModelValidationResult): string {
  const suggestions = validation.suggestions?.length ? `；建议：${validation.suggestions.join(", ")}` : "";
  return `OpenCode 模型不可用：${validation.inputModel ?? "(未填写)"} -> ${validation.resolvedModel ?? "(未解析)"}；原因：${validation.reason ?? "UNKNOWN"}${suggestions}`;
}
