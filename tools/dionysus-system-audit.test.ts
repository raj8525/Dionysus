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
