import { describe, expect, it, vi } from "vitest";
import type { AgentCliConfig, CliModelValidationResult } from "./api.js";
import { saveValidatedAgentCliConfig } from "./agent-config-validation.js";

describe("agent config validation before save", () => {
  it("validates OpenCode config and saves the resolved model", async () => {
    const config: AgentCliConfig = {
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax/MiniMax-M2.7",
      enabled: true
    };
    const validate = vi.fn(async (): Promise<CliModelValidationResult> => ({
      cliType: "opencode",
      inputModel: "minimax/MiniMax-M2.7",
      resolvedModel: "minimax-cn-coding-plan/MiniMax-M2.7",
      available: true,
      command: "opencode",
      suggestions: []
    }));
    const save = vi.fn(async (input: AgentCliConfig) => input);

    const result = await saveValidatedAgentCliConfig(config, { validate, save });

    expect(validate).toHaveBeenCalledWith({ cliType: "opencode", model: "minimax/MiniMax-M2.7" });
    expect(save).toHaveBeenCalledWith({
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
      enabled: true
    });
    expect(result.validation?.resolvedModel).toBe("minimax-cn-coding-plan/MiniMax-M2.7");
  });

  it("blocks saving when OpenCode model validation fails", async () => {
    const config: AgentCliConfig = {
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax/MiniMax-M9",
      enabled: true
    };
    const validate = vi.fn(async (): Promise<CliModelValidationResult> => ({
      cliType: "opencode",
      inputModel: "minimax/MiniMax-M9",
      resolvedModel: "minimax-cn-coding-plan/MiniMax-M9",
      available: false,
      command: "opencode",
      reason: "MODEL_NOT_FOUND",
      suggestions: ["minimax-cn-coding-plan/MiniMax-M2.7"]
    }));
    const save = vi.fn(async (input: AgentCliConfig) => input);

    await expect(saveValidatedAgentCliConfig(config, { validate, save })).rejects.toThrow(
      "OpenCode 模型不可用"
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("does not validate mock configs", async () => {
    const config: AgentCliConfig = {
      role: "master",
      cliType: "mock",
      enabled: true
    };
    const validate = vi.fn();
    const save = vi.fn(async (input: AgentCliConfig) => input);

    await saveValidatedAgentCliConfig(config, { validate, save });

    expect(validate).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(config);
  });
});
