import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import type { DionysusRepository } from "@dionysus/db";

describe("milestone E2E routes", () => {
  it("returns 409 instead of faking success when E2E request violates the milestone state machine", async () => {
    const repo = {
      requestMilestoneE2E: async () => {
        throw new Error("Invalid milestone transition: passed -> e2e_required");
      }
    } as unknown as DionysusRepository;

    const app = await buildServer({ repo, logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/milestones/11111111-1111-4111-8111-111111111111/request-e2e"
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: "INVALID_MILESTONE_TRANSITION"
      });
    } finally {
      await app.close();
    }
  });

  it("returns 409 instead of creating a campaign outside the E2E required state", async () => {
    const repo = {
      createE2ECampaign: async () => {
        throw new Error("Invalid milestone transition: candidate -> e2e_running");
      }
    } as unknown as DionysusRepository;

    const app = await buildServer({ repo, logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/milestones/11111111-1111-4111-8111-111111111111/e2e-campaigns",
        payload: {
          targetUrl: "http://127.0.0.1:5173",
          acceptance: ["最终用户主路径通过"]
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: "INVALID_MILESTONE_TRANSITION"
      });
    } finally {
      await app.close();
    }
  });
});
