import { describe, expect, it } from "vitest";

import { buildSupervisionAgentStatus, buildSupervisionStepRecord, summarizeSupervisionStep } from "./dionysus-supervise.js";

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

  it("builds supervision status from concrete agents and usage", () => {
    const status = buildSupervisionAgentStatus({
      goalId: "goal-1",
      health: {
        ok: true,
        worker: { ok: true },
        rabbitmq: { ok: true },
        database: { ok: true }
      },
      configs: [{ role: "worker", enabled: true }],
      agents: [
        { id: "worker-a", name: "WorkerA", status: "working" },
        { id: "worker-b", name: "WorkerB", status: "idle" }
      ],
      tasks: [{ status: "running" }],
      runs: [{ status: "running", agentId: "worker-a" }],
      usage: {
        totals: { cliCalls: 9, modelCalls: 6 }
      }
    });

    expect(status.summary).toMatchObject({
      runtime: "ready",
      agentInstances: 2,
      workingAgents: 1,
      boundRecentRuns: 1
    });
    expect(status.usage).toEqual({
      totals: { cliCalls: 9, modelCalls: 6 }
    });
  });

  it("keeps agent usage visible in each supervision step record", () => {
    expect(buildSupervisionStepRecord({
      iteration: 2,
      summary: {
        status: "working",
        shouldContinue: true,
        reason: "continue"
      },
      agentStatus: {
        summary: { runtime: "ready" },
        usage: {
          totals: { cliCalls: 11, modelCalls: 8 }
        }
      },
      runCycle: {
        summary: { status: "working" }
      }
    })).toEqual({
      iteration: 2,
      summary: {
        status: "working",
        shouldContinue: true,
        reason: "continue"
      },
      agentSummary: { runtime: "ready" },
      agentUsage: { totals: { cliCalls: 11, modelCalls: 8 } },
      runCycleSummary: { status: "working" }
    });
  });
});
