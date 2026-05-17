import { describe, expect, it } from "vitest";

import { summarizeSystemHealth } from "./system-health.js";

describe("system health summary", () => {
  it("summarizes all runtime checks as ready when every dependency is ok", () => {
    expect(summarizeSystemHealth({
      ok: true,
      service: "dionysus-api",
      database: { ok: true, schema: "dionysus", databaseTime: "2026-05-16T12:00:00.000Z" },
      rabbitmq: { ok: true, urlConfigured: true, checkedAt: "2026-05-16T12:00:00.000Z" },
      worker: { ok: true, status: "ok", ageSeconds: 12, maxAgeSeconds: 90 }
    })).toEqual({
      overall: "ready",
      database: "ready",
      rabbitmq: "ready",
      worker: "ready",
      workerLabel: "ok / 12s"
    });
  });

  it("shows the effective Worker CLI from role config instead of the runtime fallback", () => {
    expect(summarizeSystemHealth({
      ok: true,
      service: "dionysus-api",
      database: { ok: true, schema: "dionysus", databaseTime: "2026-05-16T12:00:00.000Z" },
      rabbitmq: { ok: true, urlConfigured: true, checkedAt: "2026-05-16T12:00:00.000Z" },
      worker: {
        ok: true,
        status: "ok",
        ageSeconds: 12,
        maxAgeSeconds: 90,
        effectiveRunConfig: {
          source: "role_config",
          cliType: "opencode",
          cliModel: "minimax-cn-coding-plan/MiniMax-M2.7",
          runtimeCliType: "mock"
        }
      }
    })).toEqual({
      overall: "ready",
      database: "ready",
      rabbitmq: "ready",
      worker: "ready",
      workerLabel: "ok / 12s / opencode"
    });
  });

  it("marks runtime degraded when worker is stale", () => {
    expect(summarizeSystemHealth({
      ok: false,
      service: "dionysus-api",
      database: { ok: true, schema: "dionysus", databaseTime: "2026-05-16T12:00:00.000Z" },
      rabbitmq: { ok: true, urlConfigured: true, checkedAt: "2026-05-16T12:00:00.000Z" },
      worker: { ok: false, status: "stale", ageSeconds: 120, maxAgeSeconds: 90 }
    })).toEqual({
      overall: "degraded",
      database: "ready",
      rabbitmq: "ready",
      worker: "blocked",
      workerLabel: "stale / 120s"
    });
  });
});
