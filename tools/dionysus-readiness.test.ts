import { describe, expect, it } from "vitest";
import { assertReadyForFastLaneStart, buildCodexReadinessSummary } from "./dionysus-readiness.js";

describe("Codex readiness summary", () => {
  it("passes only when runtime, configured CLI agents, and target project are ready", () => {
    const summary = buildCodexReadinessSummary({
      targetRoot: "/repo/Coupon",
      health: {
        ok: true,
        database: { ok: true },
        rabbitmq: { ok: true },
        worker: { ok: true }
      },
      cliProbe: [
        { cliType: "opencode", available: true },
        { cliType: "gemini_cli", available: true },
        { cliType: "claude_code", available: true }
      ],
      configs: [
        { role: "master", cliType: "claude_code", enabled: true },
        { role: "rule_writer", cliType: "gemini_cli", enabled: true },
        { role: "test_writer", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true },
        { role: "worker", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true }
      ],
      target: {
        gitClean: true,
        changes: [],
        hasAgentsMd: true,
        hasPlan: true,
        hasSpecs: true,
        hasFeaturesTest: true
      }
    });

    expect(summary.status).toBe("ready");
    expect(summary.blockers).toEqual([]);
    expect(summary.nextAction).toContain("可以启动 fast lane");
    expect(summary.nextCommands.join("\n")).toContain("fastlane coupon-module-plan");
  });

  it("blocks when target worktree is dirty or worker is still mock", () => {
    const summary = buildCodexReadinessSummary({
      targetRoot: "/repo/Coupon",
      health: {
        ok: true,
        database: { ok: true },
        rabbitmq: { ok: true },
        worker: { ok: true }
      },
      cliProbe: [
        { cliType: "opencode", available: true },
        { cliType: "mock", available: true }
      ],
      configs: [
        { role: "worker", cliType: "mock", enabled: true }
      ],
      target: {
        gitClean: false,
        changes: ["?? .env", " M apps/admin-web/src/pages/login.vue"],
        hasAgentsMd: true,
        hasPlan: true,
        hasSpecs: true,
        hasFeaturesTest: true
      }
    });

    expect(summary.status).toBe("blocked");
    expect(summary.blockers).toContain("Worker 仍配置为 mock，不能证明低成本真实 CLI 可用");
    expect(summary.blockers).toContain("目标项目工作区不干净：2 个改动");
    expect(summary.nextCommands).toContain("cd /repo/Coupon && git status --short");
  });

  it("allows explicitly acknowledged dirty paths while blocking unknown changes", () => {
    const baseInput = {
      targetRoot: "/repo/Coupon",
      health: {
        ok: true,
        database: { ok: true },
        rabbitmq: { ok: true },
        worker: { ok: true }
      },
      cliProbe: [
        { cliType: "opencode", available: true },
        { cliType: "gemini_cli", available: true },
        { cliType: "claude_code", available: true }
      ],
      configs: [
        { role: "master", cliType: "claude_code", enabled: true },
        { role: "rule_writer", cliType: "gemini_cli", enabled: true },
        { role: "test_writer", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true },
        { role: "worker", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true }
      ],
      target: {
        gitClean: false,
        changes: [" M apps/admin-web/src/pages/login.vue"],
        hasAgentsMd: true,
        hasPlan: true,
        hasSpecs: true,
        hasFeaturesTest: true
      }
    };

    const allowed = buildCodexReadinessSummary({
      ...baseInput,
      allowedDirtyPaths: ["apps/admin-web/src/pages/login.vue"]
    });

    expect(allowed.status).toBe("ready");
    expect(allowed.target.allowedDirtyChanges).toEqual([" M apps/admin-web/src/pages/login.vue"]);
    expect(allowed.target.blockingChanges).toEqual([]);

    const blocked = buildCodexReadinessSummary({
      ...baseInput,
      target: {
        ...baseInput.target,
        changes: [
          " M apps/admin-web/src/pages/login.vue",
          " M apps/admin-web/src/pages/hotels.vue"
        ]
      },
      allowedDirtyPaths: ["apps/admin-web/src/pages/login.vue"]
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.target.allowedDirtyChanges).toEqual([" M apps/admin-web/src/pages/login.vue"]);
    expect(blocked.target.blockingChanges).toEqual([" M apps/admin-web/src/pages/hotels.vue"]);
    expect(blocked.target.suggestedDirtyAllowances).toEqual(["apps/admin-web/src/pages/hotels.vue"]);
    expect(blocked.blockers).toContain("目标项目存在未允许的工作区改动：1 个");
    expect(blocked.nextCommands.join("\n")).toContain("--allow-dirty-path \"apps/admin-web/src/pages/hotels.vue\"");
    expect(blocked.nextCommands.join("\n")).toContain("--allow-dirty-path \"apps/admin-web/src/pages/login.vue\"");
  });

  it("allows explicitly acknowledged untracked directories and suggests directory allowances", () => {
    const baseInput = {
      targetRoot: "/repo/Coupon",
      health: {
        ok: true,
        database: { ok: true },
        rabbitmq: { ok: true },
        worker: { ok: true }
      },
      cliProbe: [
        { cliType: "opencode", available: true },
        { cliType: "gemini_cli", available: true },
        { cliType: "claude_code", available: true }
      ],
      configs: [
        { role: "master", cliType: "claude_code", enabled: true },
        { role: "rule_writer", cliType: "gemini_cli", enabled: true },
        { role: "test_writer", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true },
        { role: "worker", cliType: "opencode", cliModel: "minimax-cn-coding-plan/MiniMax-M2.7", enabled: true }
      ],
      target: {
        gitClean: false,
        changes: ["?? docs/data/"],
        hasAgentsMd: true,
        hasPlan: true,
        hasSpecs: true,
        hasFeaturesTest: true
      }
    };

    const blocked = buildCodexReadinessSummary(baseInput);
    expect(blocked.status).toBe("blocked");
    expect(blocked.target.suggestedDirtyAllowances).toEqual(["docs/data/"]);
    expect(blocked.nextCommands.join("\n")).toContain("--allow-dirty-path \"docs/data/\"");

    const allowed = buildCodexReadinessSummary({
      ...baseInput,
      allowedDirtyPaths: ["docs/data/"]
    });
    expect(allowed.status).toBe("ready");
    expect(allowed.target.allowedDirtyChanges).toEqual(["?? docs/data/"]);
    expect(allowed.target.blockingChanges).toEqual([]);
  });

  it("throws before fastlane start when readiness is blocked", () => {
    const summary = buildCodexReadinessSummary({
      targetRoot: "/repo/Coupon",
      health: {
        ok: true,
        database: { ok: true },
        rabbitmq: { ok: true },
        worker: { ok: true }
      },
      cliProbe: [
        { cliType: "opencode", available: true }
      ],
      configs: [
        { role: "worker", cliType: "mock", enabled: true }
      ],
      target: {
        gitClean: false,
        changes: [" M apps/admin-web/src/pages/login.vue"],
        hasAgentsMd: true,
        hasPlan: true,
        hasSpecs: true,
        hasFeaturesTest: true
      }
    });

    expect(() => assertReadyForFastLaneStart(summary)).toThrow("fastlane start blocked by readiness");
    expect(() => assertReadyForFastLaneStart(summary)).toThrow("Worker 仍配置为 mock");
    expect(() => assertReadyForFastLaneStart({
      ...summary,
      status: "ready",
      blockers: []
    })).not.toThrow();
  });
});
