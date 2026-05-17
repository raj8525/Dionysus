import { describe, expect, it } from "vitest";

import { summarizeAgentControlStatus } from "./dionysus-agent-status.js";

describe("agent control status summary", () => {
  it("summarizes configured agents, runtime health, and active work", () => {
    expect(summarizeAgentControlStatus({
      health: {
        ok: true,
        worker: { ok: true, status: "ok" },
        rabbitmq: { ok: true },
        database: { ok: true }
      },
      configs: [
        { role: "master", cliType: "claude_code", enabled: true },
        { role: "worker", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true }
      ],
      agents: [
        { name: "Master", role: "master", status: "idle" },
        { name: "WorkerA", role: "worker", status: "working" },
        { name: "WorkerB", role: "worker", status: "idle" }
      ],
      tasks: [
        { status: "queued" },
        { status: "running" },
        { status: "blocked" }
      ],
      runs: [
        { status: "running", agentId: "worker-a" },
        { status: "done", agentId: "master" }
      ]
    })).toEqual({
      runtime: "ready",
      configuredAgents: 2,
      disabledAgents: 0,
      agentInstances: 3,
      idleAgents: 2,
      workingAgents: 1,
      blockedAgentInstances: 0,
      disabledAgentInstances: 0,
      queuedTasks: 1,
      runningTasks: 1,
      blockedTasks: 1,
      runningRuns: 1,
      boundRecentRuns: 2,
      unboundRecentRuns: 0,
      nextAction: "继续运行 goal run-cycle 或等待 Worker 消费队列"
    });
  });

  it("surfaces runtime blocker first", () => {
    expect(summarizeAgentControlStatus({
      health: {
        ok: false,
        worker: { ok: false, status: "stale" },
        rabbitmq: { ok: true },
        database: { ok: true }
      },
      configs: [],
      agents: [],
      tasks: [],
      runs: []
    })).toMatchObject({
      runtime: "blocked",
      nextAction: "先修复 system doctor 中的 PostgreSQL / RabbitMQ / Worker blocker"
    });
  });

  it("flags inconsistent runtime when running runs are not bound to concrete agents", () => {
    expect(summarizeAgentControlStatus({
      health: {
        ok: true,
        worker: { ok: true, status: "ok" },
        rabbitmq: { ok: true },
        database: { ok: true }
      },
      configs: [{ role: "master", cliType: "mock", enabled: true }],
      agents: [{ name: "Master", role: "master", status: "idle" }],
      tasks: [{ status: "running" }],
      runs: [{ status: "running" }]
    })).toMatchObject({
      runtime: "blocked",
      runningRuns: 1,
      workingAgents: 0,
      unboundRecentRuns: 1,
      nextAction: "存在 running run 未绑定具体 Agent，先检查 Runtime 版本与 task_runs.agent_id"
    });
  });

  it("does not let historical unbound runs block a currently bound running run", () => {
    expect(summarizeAgentControlStatus({
      health: {
        ok: true,
        worker: { ok: true, status: "ok" },
        rabbitmq: { ok: true },
        database: { ok: true }
      },
      configs: [{ role: "master", cliType: "claude_code", enabled: true }],
      agents: [{ name: "Master", role: "master", status: "working" }],
      tasks: [{ status: "running" }],
      runs: [
        { status: "running", agentId: "master-1" },
        { status: "succeeded" },
        { status: "failed" }
      ]
    })).toMatchObject({
      runtime: "ready",
      runningRuns: 1,
      workingAgents: 1,
      unboundRecentRuns: 2
    });
  });
});
