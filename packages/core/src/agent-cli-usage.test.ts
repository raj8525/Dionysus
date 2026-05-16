import { describe, expect, it } from "vitest";

import { buildAgentCliUsageSummary } from "./agent-cli-usage.js";

describe("buildAgentCliUsageSummary", () => {
  it("summarizes CLI calls and inferred model calls by agent instance", () => {
    const summary = buildAgentCliUsageSummary({
      goalId: "goal-1",
      generatedAt: "2026-05-17T00:00:00.000Z",
      rows: [
        {
          role: "worker",
          agentId: "worker-a",
          agentName: "WorkerA",
          cliType: "opencode",
          cliModel: "minimax/MiniMax-M2.7",
          status: "succeeded",
          runAt: "2026-05-17T00:00:01.000Z"
        },
        {
          role: "worker",
          agentId: "worker-a",
          agentName: "WorkerA",
          cliType: "opencode",
          cliModel: "minimax/MiniMax-M2.7",
          status: "running",
          runAt: "2026-05-17T00:00:02.000Z"
        },
        {
          role: "master",
          agentId: null,
          agentName: null,
          cliType: "mock",
          cliModel: null,
          status: "failed",
          runAt: "2026-05-17T00:00:03.000Z"
        }
      ]
    });

    expect(summary.totals).toMatchObject({
      cliCalls: 3,
      modelCalls: 2,
      runningCalls: 1,
      succeededCalls: 1,
      failedCalls: 1,
      distinctModels: 1
    });
    expect(summary.byAgentInstance).toEqual([
      expect.objectContaining({
        agentKey: "role:master",
        agentName: "Master",
        cliCalls: 1,
        modelCalls: 0
      }),
      expect.objectContaining({
        agentKey: "agent:worker-a",
        agentName: "WorkerA",
        cliCalls: 2,
        modelCalls: 2,
        runningCalls: 1,
        lastRunAt: "2026-05-17T00:00:02.000Z"
      })
    ]);
  });

  it("accepts pre-aggregated rows from PostgreSQL", () => {
    const summary = buildAgentCliUsageSummary({
      rows: [
        {
          role: "test_writer",
          agentId: null,
          agentName: null,
          cliType: "gemini_cli",
          cliModel: "gemini-2.5-pro",
          status: "failed",
          cliCalls: 4,
          runAt: "2026-05-17T00:00:04.000Z"
        }
      ]
    });

    expect(summary.totals.cliCalls).toBe(4);
    expect(summary.totals.modelCalls).toBe(4);
    expect(summary.totals.failedCalls).toBe(4);
    expect(summary.byAgentInstance[0]).toMatchObject({
      agentKey: "role:test_writer",
      agentName: "TestWriter",
      cliCalls: 4,
      modelCalls: 4,
      failedCalls: 4
    });
  });
});
