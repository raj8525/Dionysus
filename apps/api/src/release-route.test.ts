import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import type { DionysusRepository } from "@dionysus/db";

const releasePayload = {
  goalId: "11111111-1111-4111-8111-111111111111",
  codexOutboxEventId: "22222222-2222-4222-8222-222222222222",
  targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
  branch: "main",
  commitSha: "abc123",
  status: "passed",
  pushed: true,
  changedFiles: ["apps/admin-web/src/pages/example.vue"],
  verification: [{ command: "pnpm test", status: "passed" }],
  summary: "已验证并推送。"
};

describe("POST /api/releases", () => {
  it("accepts a release record linked to the same pending release_ready outbox event", async () => {
    const created: unknown[] = [];
    const repo = {
      getGoal: async () => ({ id: releasePayload.goalId, status: "fast_lane" }),
      getCodexOutboxEvent: async () => ({
        id: releasePayload.codexOutboxEventId,
        goalId: releasePayload.goalId,
        eventType: "release_ready",
        status: "pending"
      }),
      createReleaseRecord: async (input: unknown) => {
        created.push(input);
        return { id: "release-1", ...releasePayload };
      }
    } as unknown as DionysusRepository;

    const app = await buildServer({ repo, logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/releases",
        payload: releasePayload
      });

      expect(response.statusCode).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        goalId: releasePayload.goalId,
        codexOutboxEventId: releasePayload.codexOutboxEventId
      });
    } finally {
      await app.close();
    }
  });

  it("rejects a release_ready outbox link that belongs to another goal", async () => {
    const repo = {
      getGoal: async () => ({ id: releasePayload.goalId, status: "fast_lane" }),
      getCodexOutboxEvent: async () => ({
        id: releasePayload.codexOutboxEventId,
        goalId: "33333333-3333-4333-8333-333333333333",
        eventType: "release_ready",
        status: "pending"
      })
    } as unknown as DionysusRepository;

    const app = await buildServer({ repo, logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/releases",
        payload: releasePayload
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: "RELEASE_RECORD_OUTBOX_MISMATCH"
      });
    } finally {
      await app.close();
    }
  });

  it("rejects release records linked to non-release_ready outbox events", async () => {
    const repo = {
      getGoal: async () => ({ id: releasePayload.goalId, status: "fast_lane" }),
      getCodexOutboxEvent: async () => ({
        id: releasePayload.codexOutboxEventId,
        goalId: releasePayload.goalId,
        eventType: "blocker",
        status: "pending"
      })
    } as unknown as DionysusRepository;

    const app = await buildServer({ repo, logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/releases",
        payload: releasePayload
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: "RELEASE_RECORD_OUTBOX_MISMATCH"
      });
    } finally {
      await app.close();
    }
  });
});
