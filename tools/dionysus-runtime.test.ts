import { describe, expect, it } from "vitest";

import { buildRuntimeHealPlan, buildRuntimeProcessSpecs, summarizeRuntimeStatus, waitForRuntimeReady } from "./dionysus-runtime.js";

describe("Dionysus runtime process management", () => {
  it("builds stable API and Worker process specs from the repo root", () => {
    const specs = buildRuntimeProcessSpecs({
      repoRoot: "/repo/dionysus",
      logDir: ".dionysus/logs",
      pidDir: ".dionysus/pids"
    });

    expect(specs).toEqual([
      expect.objectContaining({
        name: "api",
        cwd: "/repo/dionysus/apps/api",
        command: "/repo/dionysus/node_modules/.bin/tsx",
        args: ["src/server.ts"],
        logFile: "/repo/dionysus/.dionysus/logs/api.log",
        pidFile: "/repo/dionysus/.dionysus/pids/api.pid"
      }),
      expect.objectContaining({
        name: "worker",
        cwd: "/repo/dionysus/apps/worker",
        command: "/repo/dionysus/node_modules/.bin/tsx",
        args: ["src/worker.ts"],
        logFile: "/repo/dionysus/.dionysus/logs/worker.log",
        pidFile: "/repo/dionysus/.dionysus/pids/worker.pid"
      })
    ]);
  });

  it("summarizes runtime status from pid checks", () => {
    expect(summarizeRuntimeStatus([
      { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
      { name: "worker", pid: 202, running: false, pidFile: "worker.pid", logFile: "worker.log" }
    ])).toEqual({
      ok: false,
      processes: [
        { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
        { name: "worker", pid: 202, running: false, pidFile: "worker.pid", logFile: "worker.log" }
      ],
      nextAction: "运行 pnpm dionysus system runtime start"
    });
  });

  it("starts missing runtime processes during heal", () => {
    expect(buildRuntimeHealPlan({
      processStatus: {
        ok: false,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: false, pidFile: "worker.pid", logFile: "worker.log" }
        ]
      }
    })).toEqual({
      action: "start",
      reason: "process not running: worker",
      nextAction: "运行 pnpm dionysus system runtime start"
    });
  });

  it("restarts a running runtime when worker health is stale", () => {
    expect(buildRuntimeHealPlan({
      processStatus: {
        ok: true,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: true, pidFile: "worker.pid", logFile: "worker.log" }
        ]
      },
      health: {
        ok: false,
        worker: { ok: false, status: "stale" }
      }
    })).toEqual({
      action: "restart",
      reason: "worker health stale",
      nextAction: "重启 Dionysus runtime 并重新检查 doctor/readiness"
    });
  });

  it("restarts healthy runtime processes when the worker is running an older commit", () => {
    expect(buildRuntimeHealPlan({
      processStatus: {
        ok: true,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: true, pidFile: "worker.pid", logFile: "worker.log" }
        ]
      },
      health: {
        ok: true,
        worker: {
          ok: true,
          status: "ok",
          runtime: {
            codeCommitSha: "old-commit"
          }
        }
      },
      currentCodeCommitSha: "new-commit"
    })).toEqual({
      action: "restart",
      reason: "worker runtime commit stale: old-commit != new-commit",
      nextAction: "重启 Dionysus runtime 并重新检查 doctor/readiness"
    });
  });

  it("restarts healthy runtime processes when the API is running an older commit", () => {
    expect(buildRuntimeHealPlan({
      processStatus: {
        ok: true,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: true, pidFile: "worker.pid", logFile: "worker.log" }
        ]
      },
      health: {
        ok: true,
        runtime: {
          codeCommitSha: "old-api-commit"
        },
        worker: {
          ok: true,
          status: "ok",
          runtime: {
            codeCommitSha: "new-commit"
          }
        }
      },
      currentCodeCommitSha: "new-commit"
    })).toEqual({
      action: "restart",
      reason: "api runtime commit stale: old-api-commit != new-commit",
      nextAction: "重启 Dionysus runtime 并重新检查 doctor/readiness"
    });
  });

  it("does not restart healthy runtime processes", () => {
    expect(buildRuntimeHealPlan({
      processStatus: {
        ok: true,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: true, pidFile: "worker.pid", logFile: "worker.log" }
        ]
      },
      health: {
        ok: true,
        worker: { ok: true, status: "ok" }
      }
    })).toEqual({
      action: "none",
      reason: "runtime healthy",
      nextAction: "继续执行 Dionysus goal/readiness/fastlane"
    });
  });

  it("waits until the API readiness check succeeds before reporting runtime ready", async () => {
    let attempts = 0;
    const result = await waitForRuntimeReady({
      timeoutMs: 1000,
      intervalMs: 1,
      status: () => ({
        ok: true,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: true, pidFile: "worker.pid", logFile: "worker.log" }
        ],
        nextAction: "运行 pnpm dionysus system doctor --brief 验证依赖"
      }),
      ready: async () => {
        attempts += 1;
        return attempts === 3;
      },
      sleep: async () => undefined
    });

    expect(result.ready).toBe(true);
    expect(result.readiness?.attempts).toBe(3);
    expect(result.nextAction).toBe("运行 pnpm dionysus system doctor --brief 验证依赖");
  });

  it("keeps runtime not ready when processes run but API health never responds", async () => {
    const result = await waitForRuntimeReady({
      timeoutMs: 3,
      intervalMs: 1,
      status: () => ({
        ok: true,
        processes: [
          { name: "api", pid: 101, running: true, pidFile: "api.pid", logFile: "api.log" },
          { name: "worker", pid: 202, running: true, pidFile: "worker.pid", logFile: "worker.log" }
        ],
        nextAction: "运行 pnpm dionysus system doctor --brief 验证依赖"
      }),
      ready: async () => false,
      sleep: async () => undefined,
      now: (() => {
        let current = 0;
        return () => current++;
      })()
    });

    expect(result.ok).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.nextAction).toBe("API health 未就绪，查看 .dionysus/logs/api.log");
  });
});
