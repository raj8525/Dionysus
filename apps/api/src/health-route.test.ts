import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import type { DionysusRepository } from "@dionysus/db";

describe("GET /health", () => {
  it("exposes API runtime commit metadata for runtime heal", async () => {
    const repo = {
      healthCheck: async () => ({
        ok: true,
        schema: "dionysus",
        databaseTime: "2026-05-20T00:00:00.000Z"
      }),
      listSystemEvents: async () => [
        {
          eventType: "worker.heartbeat",
          createdAt: new Date().toISOString(),
          payload: {
            pid: 202,
            runtimeInstanceId: "worker-runtime-1",
            runtimeStartedAt: "2026-05-20T00:00:00.000Z",
            codeCommitSha: "api-health-test-commit"
          }
        }
      ],
      getAgentCliConfig: async () => null
    } as unknown as DionysusRepository;

    const app = await buildServer({
      repo,
      logger: false,
      apiCodeCommitSha: "api-health-test-commit",
      checkRabbitMqHealth: async () => ({
        ok: true,
        urlConfigured: true,
        checkedAt: "2026-05-20T00:00:00.000Z"
      })
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health"
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.runtime).toMatchObject({
        pid: expect.any(Number),
        runtimeInstanceId: expect.any(String),
        runtimeStartedAt: expect.any(String),
        codeCommitSha: "api-health-test-commit"
      });
      expect(body.worker.runtime.codeCommitSha).toBe("api-health-test-commit");
    } finally {
      await app.close();
    }
  });
});
