import type { CliType } from "@dionysus/core";
import { resolveOpenCodeModel } from "./opencode-model.js";
import { runCommand } from "./shell.js";

export interface CliModelValidationResult {
  cliType: CliType;
  inputModel: string | null;
  resolvedModel: string | null;
  available: boolean;
  command: string;
  reason?: string;
  suggestions?: string[];
}

export async function validateCliModel(input: {
  cliType: CliType;
  model?: string | null;
}): Promise<CliModelValidationResult> {
  if (input.cliType === "mock") {
    return {
      cliType: "mock",
      inputModel: input.model ?? null,
      resolvedModel: input.model ?? "mock/default",
      available: true,
      command: "mock"
    };
  }

  const command = commandForCli(input.cliType);
  const model = normalizeModel(input.model);

  if (input.cliType !== "opencode") {
    const version = await runCommand(command, ["--version"], 15_000);
    return {
      cliType: input.cliType,
      inputModel: model,
      resolvedModel: model,
      available: version.exitCode === 0,
      command,
      reason: version.exitCode === 0 ? undefined : version.stderr
    };
  }

  if (!model) {
    return {
      cliType: "opencode",
      inputModel: null,
      resolvedModel: null,
      available: false,
      command,
      reason: "OPENCODE_MODEL_REQUIRED_FOR_RELIABLE_RUN"
    };
  }

  const resolvedModel = resolveOpenCodeModel(model);
  const models = await runCommand(command, ["models"], 20_000);
  if (models.exitCode !== 0) {
    return {
      cliType: "opencode",
      inputModel: model,
      resolvedModel,
      available: false,
      command,
      reason: models.stderr
    };
  }

  const availableModels = parseModelList(models.stdout);
  const available = availableModels.includes(resolvedModel);
  return {
    cliType: "opencode",
    inputModel: model,
    resolvedModel,
    available,
    command,
    reason: available ? undefined : "MODEL_NOT_FOUND",
    suggestions: available ? [] : suggestModels(resolvedModel, availableModels)
  };
}

function parseModelList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function suggestModels(model: string, availableModels: string[]): string[] {
  const [, modelName = model] = model.split("/");
  const normalizedModelName = modelName.toLowerCase();
  return availableModels
    .filter((candidate) => candidate.toLowerCase().includes(normalizedModelName))
    .slice(0, 10);
}

function normalizeModel(model: string | null | undefined): string | null {
  const trimmed = model?.trim();
  return trimmed ? trimmed : null;
}

function commandForCli(cliType: Exclude<CliType, "mock">): string {
  const envName = `DIONYSUS_${cliType.toUpperCase()}_COMMAND`;
  if (process.env[envName]) return process.env[envName];
  if (cliType === "claude_code") return "claude";
  if (cliType === "gemini_cli") return "gemini";
  return "opencode";
}
