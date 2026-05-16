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
      tasks: [
        { status: "queued" },
        { status: "running" },
        { status: "blocked" }
      ],
      runs: [
        { status: "running" },
        { status: "done" }
      ]
    })).toEqual({
      runtime: "ready",
      configuredAgents: 2,
      disabledAgents: 0,
      queuedTasks: 1,
      runningTasks: 1,
      blockedTasks: 1,
      runningRuns: 1,
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
      tasks: [],
      runs: []
    })).toMatchObject({
      runtime: "blocked",
      nextAction: "先修复 system doctor 中的 PostgreSQL / RabbitMQ / Worker blocker"
    });
  });
});
