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
        agentName: "历史未绑定 Master",
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
      agentName: "历史未绑定 TestWriter",
      cliCalls: 4,
      modelCalls: 4,
      failedCalls: 4,
      lastFailedAt: "2026-05-17T00:00:04.000Z"
    });
  });

  it("tracks last succeeded and failed run timestamps for current-risk audits", () => {
    const summary = buildAgentCliUsageSummary({
      rows: [
        {
          role: "test_writer",
          agentId: "test-writer",
          agentName: "TestWriter",
          cliType: "opencode",
          cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
          status: "failed",
          cliCalls: 8,
          runAt: "2026-05-17T00:00:00.000Z"
        },
        {
          role: "test_writer",
          agentId: "test-writer",
          agentName: "TestWriter",
          cliType: "opencode",
          cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
          status: "succeeded",
          cliCalls: 2,
          runAt: "2026-05-18T00:00:00.000Z"
        }
      ]
    });

    expect(summary.byAgent[0]).toMatchObject({
      role: "test_writer",
      cliCalls: 10,
      failedCalls: 8,
      succeededCalls: 2,
      lastRunAt: "2026-05-18T00:00:00.000Z",
      lastFailedAt: "2026-05-17T00:00:00.000Z",
      lastSucceededAt: "2026-05-18T00:00:00.000Z"
    });
    expect(summary.byAgentInstance[0]).toMatchObject({
      agentName: "TestWriter",
      lastFailedAt: "2026-05-17T00:00:00.000Z",
      lastSucceededAt: "2026-05-18T00:00:00.000Z"
    });
  });

  it("keeps closed-goal failures in total usage without treating them as active-goal risk", () => {
    const summary = buildAgentCliUsageSummary({
      rows: [
        {
          role: "worker",
          agentId: "worker-a",
          agentName: "WorkerA",
          cliType: "opencode",
          cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
          status: "failed",
          goalStatus: "done",
          runAt: "2026-05-20T10:18:36.603Z"
        },
        {
          role: "worker",
          agentId: "worker-a",
          agentName: "WorkerA",
          cliType: "opencode",
          cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
          status: "succeeded",
          goalStatus: "fast_lane",
          runAt: "2026-05-20T08:53:58.360Z"
        }
      ]
    });

    expect(summary.activeGoalRunTracking).toBe(true);
    expect(summary.byAgent[0]).toMatchObject({
      failedCalls: 1,
      lastFailedAt: "2026-05-20T10:18:36.603Z",
      latestActiveRunAt: "2026-05-20T08:53:58.360Z",
      latestActiveSucceededAt: "2026-05-20T08:53:58.360Z",
      latestActiveFailedAt: undefined
    });
  });

  it("uses persisted model call counts before falling back to inferred CLI calls", () => {
    const summary = buildAgentCliUsageSummary({
      rows: [
        {
          role: "worker",
          agentId: "worker-a",
          agentName: "WorkerA",
          cliType: "opencode",
          cliModel: "minimax/MiniMax-M2.7",
          status: "succeeded",
          cliCalls: 2,
          modelCalls: 7,
          runAt: "2026-05-17T00:00:04.000Z"
        },
        {
          role: "test_writer",
          agentId: "test-writer",
          agentName: "TestWriter",
          cliType: "gemini_cli",
          cliModel: "gemini-2.5-pro",
          status: "succeeded",
          cliCalls: 3,
          runAt: "2026-05-17T00:00:05.000Z"
        }
      ]
    });

    expect(summary.totals.cliCalls).toBe(5);
    expect(summary.totals.modelCalls).toBe(10);
    expect(summary.byAgentInstance).toEqual([
      expect.objectContaining({
        agentName: "TestWriter",
        cliCalls: 3,
        modelCalls: 3
      }),
      expect.objectContaining({
        agentName: "WorkerA",
        cliCalls: 2,
        modelCalls: 7
      })
    ]);
  });

  it("keeps the selected project target root in the usage scope", () => {
    const summary = buildAgentCliUsageSummary({
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      rows: []
    });

    expect(summary).toMatchObject({
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      totals: {
        cliCalls: 0,
        modelCalls: 0
      }
    });
  });

  it("includes every configured agent instance even when it has no CLI runs yet", () => {
    const summary = buildAgentCliUsageSummary({
      rows: [
        {
          role: "worker",
          agentId: "worker-a",
          agentName: "WorkerA",
          cliType: "opencode",
          cliModel: "minimax/MiniMax-M2.7",
          status: "succeeded",
          modelCalls: 2
        }
      ],
      agentBaselines: [
        {
          id: "master",
          name: "Master",
          role: "master",
          status: "idle"
        },
        {
          id: "worker-a",
          name: "WorkerA",
          role: "worker",
          status: "idle"
        },
        {
          id: "worker-b",
          name: "WorkerB",
          role: "worker",
          status: "idle"
        }
      ]
    });

    expect(summary.byAgentInstance).toEqual([
      expect.objectContaining({
        agentKey: "agent:master",
        agentName: "Master",
        role: "master",
        agentStatus: "idle",
        cliCalls: 0,
        modelCalls: 0,
        models: []
      }),
      expect.objectContaining({
        agentKey: "agent:worker-a",
        agentName: "WorkerA",
        role: "worker",
        agentStatus: "idle",
        cliCalls: 1,
        modelCalls: 2
      }),
      expect.objectContaining({
        agentKey: "agent:worker-b",
        agentName: "WorkerB",
        role: "worker",
        agentStatus: "idle",
        cliCalls: 0,
        modelCalls: 0,
        models: []
      })
    ]);
  });
});
