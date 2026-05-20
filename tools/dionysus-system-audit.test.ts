import { describe, expect, it } from "vitest";

import { buildSystemAuditSummary } from "./dionysus-system-audit.js";
import type { CodexReadinessSummary } from "./dionysus-readiness.js";

function readyReadiness(overrides: Partial<CodexReadinessSummary> = {}): CodexReadinessSummary {
  return {
    status: "ready",
    targetRoot: "/repo/Coupon",
    blockers: [],
    runtime: {
      ok: true,
      database: true,
      rabbitmq: true,
      worker: true
    },
    configuredRoles: [
      { role: "master", cliType: "claude_code", enabled: true, cliAvailable: true },
      { role: "rule_writer", cliType: "gemini_cli", enabled: true, cliAvailable: true },
      { role: "test_writer", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true, cliAvailable: true },
      { role: "worker", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true, cliAvailable: true }
    ],
    target: {
      gitClean: true,
      changes: [],
      hasAgentsMd: true,
      hasMemoryMd: true,
      agentsMentionsMemory: true,
      hasPlan: true,
      hasSpecs: true,
      hasFeaturesTest: true
    },
    nextAction: "可以启动 fast lane",
    nextCommands: ["pnpm -s dionysus fastlane plan --title ..."],
    ...overrides
  };
}

describe("Dionysus system audit summary", () => {
  it("blocks when readiness has blockers and preserves the remediation commands", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness({
        status: "blocked",
        blockers: ["Worker Runtime 未就绪"],
        nextAction: "先处理 blockers",
        nextCommands: ["pnpm -s dionysus system runtime heal"]
      }),
      usage: {
        totals: { cliCalls: 40, modelCalls: 40, runningCalls: 0, succeededCalls: 40, failedCalls: 0 },
        byAgent: [],
        byCli: []
      },
      pendingCodexOutbox: []
    });

    expect(summary.status).toBe("blocked");
    expect(summary.blockers).toEqual(["Worker Runtime 未就绪"]);
    expect(summary.nextAction).toContain("先处理 readiness blockers");
    expect(summary.nextCommands).toContain("pnpm -s dionysus system runtime heal");
  });

  it("requires Codex attention when outbox events are pending", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness(),
      usage: {
        totals: { cliCalls: 8, modelCalls: 8, runningCalls: 0, succeededCalls: 8, failedCalls: 0 },
        byAgent: [],
        byCli: [{ cliType: "opencode", cliCalls: 8, modelCalls: 8, failedCalls: 0 }]
      },
      pendingCodexOutbox: [
        { id: "outbox-1", eventType: "milestone_review_required" },
        { id: "outbox-2", eventType: "release_review_required" }
      ]
    });

    expect(summary.status).toBe("needs_attention");
    expect(summary.warnings).toContain("存在 2 个 pending Codex Outbox 事件，需要 Codex 处理或 ack");
    expect(summary.nextAction).toContain("先处理 Codex Outbox");
    expect(summary.nextCommands).toContain("cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus codex heartbeat --limit 5");
  });

  it("flags high failure rate roles without blocking new work", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness(),
      usage: {
        totals: { cliCalls: 50, modelCalls: 50, runningCalls: 0, succeededCalls: 36, failedCalls: 14 },
        byCli: [{ cliType: "opencode", cliCalls: 50, modelCalls: 50, failedCalls: 14 }],
        byAgent: [
          { role: "test_writer", cliCalls: 12, modelCalls: 12, succeededCalls: 4, failedCalls: 8 },
          { role: "worker", cliCalls: 38, modelCalls: 38, succeededCalls: 32, failedCalls: 6 }
        ]
      },
      pendingCodexOutbox: []
    });

    expect(summary.status).toBe("needs_attention");
    expect(summary.warnings).toContain("test_writer CLI 失败率偏高：8/12");
    expect(summary.nextCommands).toContain("cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus agent usage --target-root \"/repo/Coupon\"");
  });

  it("treats high historical failure rate as recovered when the latest role run succeeded", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness(),
      usage: {
        totals: {
          cliCalls: 32,
          modelCalls: 32,
          runningCalls: 0,
          succeededCalls: 20,
          failedCalls: 12,
          lastRunAt: "2026-05-17T02:31:25.107Z",
          lastFailedAt: "2026-05-17T02:17:45.884Z",
          lastSucceededAt: "2026-05-17T02:31:25.107Z"
        },
        byCli: [{ cliType: "opencode", cliCalls: 32, modelCalls: 32, failedCalls: 12 }],
        byAgent: [
          {
            role: "test_writer",
            cliCalls: 21,
            modelCalls: 18,
            succeededCalls: 9,
            failedCalls: 12,
            lastRunAt: "2026-05-17T02:31:25.107Z",
            lastFailedAt: "2026-05-17T02:17:45.884Z",
            lastSucceededAt: "2026-05-17T02:31:25.107Z"
          },
          { role: "worker", cliCalls: 11, modelCalls: 11, succeededCalls: 11, failedCalls: 0 }
        ]
      },
      pendingCodexOutbox: []
    });

    expect(summary.status).toBe("ready");
    expect(summary.warnings).toEqual([]);
    expect(summary.notes).toContain("test_writer 曾有较高历史失败率：12/21，但最近一次运行已成功");
  });

  it("requires attention when a role's latest run failed even if the historical failure rate is acceptable", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness(),
      usage: {
        totals: {
          cliCalls: 80,
          modelCalls: 80,
          runningCalls: 0,
          succeededCalls: 70,
          failedCalls: 10,
          lastRunAt: "2026-05-20T10:18:36.603Z",
          lastSucceededAt: "2026-05-20T08:53:58.360Z",
          lastFailedAt: "2026-05-20T10:18:36.603Z"
        },
        byCli: [{ cliType: "opencode", cliCalls: 80, modelCalls: 80, succeededCalls: 70, failedCalls: 10 }],
        byAgent: [
          {
            role: "worker",
            cliCalls: 79,
            modelCalls: 79,
            succeededCalls: 64,
            failedCalls: 15,
            lastRunAt: "2026-05-20T10:18:36.603Z",
            lastSucceededAt: "2026-05-20T08:53:58.360Z",
            lastFailedAt: "2026-05-20T10:18:36.603Z"
          }
        ]
      },
      pendingCodexOutbox: []
    });

    expect(summary.status).toBe("needs_attention");
    expect(summary.warnings).toContain("worker 最近一次 CLI 运行失败，尚无后续成功恢复证据");
    expect(summary.nextAction).toContain("先查看最近失败");
  });

  it("does not warn on recent historical failures when active-goal usage has recovered", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness(),
      usage: {
        activeGoalRunTracking: true,
        totals: {
          cliCalls: 80,
          modelCalls: 80,
          runningCalls: 0,
          succeededCalls: 70,
          failedCalls: 10,
          lastRunAt: "2026-05-20T10:18:36.603Z",
          lastSucceededAt: "2026-05-20T08:53:58.360Z",
          lastFailedAt: "2026-05-20T10:18:36.603Z",
          latestActiveRunAt: "2026-05-20T08:53:58.360Z",
          latestActiveSucceededAt: "2026-05-20T08:53:58.360Z"
        },
        byCli: [{ cliType: "opencode", cliCalls: 80, modelCalls: 80, succeededCalls: 70, failedCalls: 10 }],
        byAgent: [
          {
            role: "worker",
            cliCalls: 79,
            modelCalls: 79,
            succeededCalls: 64,
            failedCalls: 15,
            lastRunAt: "2026-05-20T10:18:36.603Z",
            lastSucceededAt: "2026-05-20T08:53:58.360Z",
            lastFailedAt: "2026-05-20T10:18:36.603Z",
            latestActiveRunAt: "2026-05-20T08:53:58.360Z",
            latestActiveSucceededAt: "2026-05-20T08:53:58.360Z"
          }
        ]
      },
      pendingCodexOutbox: []
    });

    expect(summary.warnings).not.toContain("worker 最近一次 CLI 运行失败，尚无后续成功恢复证据");
    expect(summary.nextAction).toContain("可以启动或继续一个完整模块");
  });

  it("requires attention when stale open goals can pollute active-goal tracking", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      now: "2026-05-20T10:00:00.000Z",
      readiness: readyReadiness(),
      usage: {
        activeGoalRunTracking: true,
        totals: { cliCalls: 24, modelCalls: 24, runningCalls: 0, succeededCalls: 24, failedCalls: 0 },
        byCli: [{ cliType: "opencode", cliCalls: 24, modelCalls: 24, failedCalls: 0 }],
        byAgent: [{ role: "worker", cliCalls: 24, modelCalls: 24, succeededCalls: 24, failedCalls: 0 }]
      },
      openGoals: [
        {
          id: "old-smoke",
          title: "Role Queue Smoke",
          status: "created",
          targetRoot: "/repo/Coupon",
          createdAt: "2026-05-16T08:32:02.000Z",
          updatedAt: "2026-05-16T08:32:02.000Z"
        },
        {
          id: "recent-fast-lane",
          title: "当前模块",
          status: "fast_lane",
          targetRoot: "/repo/Coupon",
          createdAt: "2026-05-20T09:50:00.000Z",
          updatedAt: "2026-05-20T09:50:00.000Z"
        }
      ],
      pendingCodexOutbox: []
    });

    expect(summary.status).toBe("needs_attention");
    expect(summary.warnings).toContain("存在 1 个陈旧未关闭目标，会污染 active-goal 统计和 Dashboard 判断");
    expect(summary.evidence.staleOpenGoals).toEqual([
      expect.objectContaining({ id: "old-smoke", title: "Role Queue Smoke" })
    ]);
    expect(summary.nextCommands.join("\n")).toContain("pnpm -s dionysus goal cancel --goal-id old-smoke");
  });

  it("is ready when runtime, target project, real CLI usage, and Codex outbox are clean", () => {
    const summary = buildSystemAuditSummary({
      targetRoot: "/repo/Coupon",
      readiness: readyReadiness(),
      usage: {
        totals: { cliCalls: 24, modelCalls: 24, runningCalls: 0, succeededCalls: 23, failedCalls: 1 },
        byCli: [
          { cliType: "opencode", cliCalls: 18, modelCalls: 18, failedCalls: 1 },
          { cliType: "gemini_cli", cliCalls: 6, modelCalls: 6, failedCalls: 0 }
        ],
        byAgent: [
          { role: "worker", cliCalls: 18, modelCalls: 18, succeededCalls: 17, failedCalls: 1 },
          { role: "rule_writer", cliCalls: 6, modelCalls: 6, succeededCalls: 6, failedCalls: 0 }
        ]
      },
      pendingCodexOutbox: []
    });

    expect(summary.status).toBe("ready");
    expect(summary.warnings).toEqual([]);
    expect(summary.nextAction).toContain("可以启动或继续一个完整模块");
    expect(summary.nextCommands.join("\n")).toContain("fastlane coupon-module-plan");
  });
});
