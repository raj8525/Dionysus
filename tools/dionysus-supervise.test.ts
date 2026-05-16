import { describe, expect, it } from "vitest";

import { summarizeSupervisionStep } from "./dionysus-supervise.js";

describe("goal supervision step summary", () => {
  it("stops immediately when runtime is blocked", () => {
    expect(summarizeSupervisionStep({
      agentStatus: { summary: { runtime: "blocked", nextAction: "fix runtime" } },
      runCycle: { summary: { status: "working" } }
    })).toEqual({
      status: "blocked",
      shouldContinue: false,
      reason: "runtime blocked: fix runtime"
    });
  });

  it("stops when run-cycle asks Codex to run E2E", () => {
    expect(summarizeSupervisionStep({
      agentStatus: { summary: { runtime: "ready", nextAction: "continue" } },
      runCycle: { summary: { status: "e2e_required", nextActions: ["run E2E"] } }
    })).toEqual({
      status: "e2e_required",
      shouldContinue: false,
      reason: "Codex action required: run E2E"
    });
  });

  it("continues when runtime is ready and work is active", () => {
    expect(summarizeSupervisionStep({
      agentStatus: { summary: { runtime: "ready", nextAction: "continue" } },
      runCycle: { summary: { status: "working" } }
    })).toEqual({
      status: "working",
      shouldContinue: true,
      reason: "runtime ready; continuing supervision"
    });
  });
});
