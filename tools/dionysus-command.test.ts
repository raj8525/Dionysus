import { describe, expect, it } from "vitest";

import { resolveApiCommand } from "./dionysus-command.js";

describe("dionysus CLI API command resolver", () => {
  it("maps goal lifecycle commands to existing API endpoints", () => {
    const goalId = "goal-123";

    expect(resolveApiCommand(["goal", "intake", "--goal-id", goalId])).toEqual({
      path: `/api/goals/${goalId}/intake`,
      method: "POST"
    });
    expect(resolveApiCommand(["goal", "bootstrap", "--goal-id", goalId])).toEqual({
      path: `/api/goals/${goalId}/bootstrap`,
      method: "POST"
    });
    expect(resolveApiCommand(["goal", "gate-check", "--goal-id", goalId])).toEqual({
      path: `/api/goals/${goalId}/gate-check`,
      method: "POST"
    });
    expect(resolveApiCommand(["goal", "remediation", "--goal-id", goalId])).toEqual({
      path: `/api/goals/${goalId}/preflight-remediation`,
      method: "POST"
    });
    expect(resolveApiCommand(["goal", "remediation-patch", "--goal-id", goalId])).toEqual({
      path: `/api/goals/${goalId}/preflight-remediation/patch`,
      method: "POST"
    });
    expect(resolveApiCommand(["goal", "release-ready", "--goal-id", goalId])).toEqual({
      path: `/api/goals/${goalId}/integrations/release-ready`,
      method: "POST"
    });
  });

  it("maps integration list to the integration API", () => {
    expect(resolveApiCommand(["integration", "list", "--goal-id", "goal-123"])).toEqual({
      path: "/api/integrations?goalId=goal-123",
      method: "GET"
    });
  });

  it("maps agent config list to the agent config API", () => {
    expect(resolveApiCommand(["agent", "config", "list"])).toEqual({
      path: "/api/agent-cli-configs",
      method: "GET"
    });
  });

  it("maps run logs to the full task run log API", () => {
    expect(resolveApiCommand(["run", "logs", "--run-id", "run-123"])).toEqual({
      path: "/api/runs/run-123/logs",
      method: "GET"
    });
  });
});
