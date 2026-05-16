import { describe, expect, it } from "vitest";
import { normalizeAgentCliConfig } from "./agent-config.js";

describe("agent CLI config normalization", () => {
  it("defaults every role to mock when no config exists", () => {
    expect(normalizeAgentCliConfig({ role: "master" })).toEqual({
      role: "master",
      cliType: "mock",
      cliModel: undefined
    });
  });

  it("accepts supported CLI types and ignores invalid values", () => {
    expect(normalizeAgentCliConfig({ role: "worker", cliType: "opencode", cliModel: "anthropic/claude-sonnet-4" })).toEqual({
      role: "worker",
      cliType: "opencode",
      cliModel: "anthropic/claude-sonnet-4"
    });
    expect(normalizeAgentCliConfig({ role: "worker", cliType: "bad-cli" })).toMatchObject({
      role: "worker",
      cliType: "mock"
    });
  });
});
