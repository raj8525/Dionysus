import { describe, expect, it } from "vitest";

import { resolveAgentRunConfig } from "./agent-run-config.js";

describe("agent run config resolution", () => {
  it("uses the role CLI config instead of the legacy worker environment fallback", () => {
    expect(resolveAgentRunConfig({
      role: "worker",
      roleConfig: {
        role: "worker",
        cliType: "opencode",
        cliModel: "minimax-cn-coding-plan/MiniMax-M2.7"
      },
      fallback: {
        cliType: "mock"
      }
    })).toEqual({
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax-cn-coding-plan/MiniMax-M2.7"
    });
  });

  it("falls back to the process config only when no role config exists", () => {
    expect(resolveAgentRunConfig({
      role: "worker",
      fallback: {
        cliType: "opencode",
        cliModel: "minimax/MiniMax-M2.7"
      }
    })).toEqual({
      role: "worker",
      cliType: "opencode",
      cliModel: "minimax/MiniMax-M2.7"
    });
  });
});
