import { describe, expect, it } from "vitest";

import {
  buildSupervisionAgentStatus,
  buildSupervisionStepRecord,
  shouldAdvanceFastLaneDuringSupervision,
  summarizeSupervisionStep
} from "./dionysus-supervise.js";

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
      agentStatus: { summary: { runtime: "ready", queuedTasks: 1, runningTasks: 0, workingAgents: 0, nextAction: "continue" } },
      runCycle: { summary: { status: "working" } }
    })).toEqual({
      status: "working",
      shouldContinue: true,
      reason: "runtime ready; continuing supervision"
    });
  });

  it("advances fast lane during supervision when a safe phase has enqueue commands", () => {
    expect(shouldAdvanceFastLaneDuringSupervision({
      phase: "ready_for_reviewer",
      nextCommands: ["pnpm dionysus task enqueue --task-id reviewer-1"]
    })).toEqual({
      shouldAdvance: true,
      reason: "fast lane phase ready_for_reviewer can safely enqueue next tasks"
    });
  });

  it("does not advance fast lane during supervision when Codex review or E2E is required", () => {
    expect(shouldAdvanceFastLaneDuringSupervision({
      phase: "reviewer_review",
      nextCommands: ["pnpm dionysus task review --task-id reviewer-1 --verdict approve --score 90"]
    })).toEqual({
      shouldAdvance: false,
      reason: "fast lane phase reviewer_review requires Codex or Agent work before automatic advance"
    });
  });

  it("stops when run-cycle says working but no tasks or agents are active", () => {
    expect(summarizeSupervisionStep({
      agentStatus: {
        summary: {
          runtime: "ready",
          queuedTasks: 0,
          runningTasks: 0,
          runningRuns: 0,
          workingAgents: 0,
          blockedTasks: 1,
          nextAction: "没有 queued/running task，Master 必须创建下一批任务或显式结束目标"
        }
      },
      runCycle: { summary: { status: "working" } }
    })).toEqual({
      status: "blocked",
      shouldContinue: false,
      reason: "no active Dionysus work: 没有 queued/running task，Master 必须创建下一批任务或显式结束目标"
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
