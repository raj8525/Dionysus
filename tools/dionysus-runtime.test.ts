import { describe, expect, it } from "vitest";

import { buildRuntimeProcessSpecs, summarizeRuntimeStatus } from "./dionysus-runtime.js";

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
});
