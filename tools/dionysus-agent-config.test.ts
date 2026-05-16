import { describe, expect, it } from "vitest";

import { buildAgentConfigSavePlan } from "./dionysus-agent-config.js";

describe("dionysus agent config CLI", () => {
  it("uses the resolved model after validation", () => {
    expect(buildAgentConfigSavePlan({
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax/MiniMax-M2.7",
      enabled: true,
      validation: {
        cliType: "opencode",
        inputModel: "minimax/MiniMax-M2.7",
        resolvedModel: "minimax-cn-coding-plan/MiniMax-M2.7",
        available: true,
        command: "opencode"
      }
    })).toEqual({
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
      enabled: true
    });
  });

  it("rejects unavailable model configs before save", () => {
    expect(() => buildAgentConfigSavePlan({
      role: "worker",
      cliType: "opencode",
      cliModel: "bad/model",
      enabled: true,
      validation: {
        cliType: "opencode",
        inputModel: "bad/model",
        resolvedModel: "bad/model",
        available: false,
        command: "opencode",
        reason: "model not found"
      }
    })).toThrow("model not available: model not found");
  });

  it("allows mock config without model validation", () => {
    expect(buildAgentConfigSavePlan({
      role: "master",
      cliType: "mock",
      enabled: false
    })).toEqual({
      role: "master",
      cliType: "mock",
      enabled: false
    });
  });
});
