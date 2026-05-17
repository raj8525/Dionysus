import { describe, expect, it } from "vitest";

import { buildSeedEvidenceSummary } from "./seed-evidence-display.js";

describe("seed evidence display", () => {
  it("summarizes Coupon seed apply evidence for the dashboard", () => {
    const summary = buildSeedEvidenceSummary({
      id: "event-1",
      eventType: "coupon.seed_applied",
      createdAt: "2026-05-17T09:23:00.000Z",
      payload: {
        targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
        migrationPath: "migrations/026_hotel_store_create_fields.sql",
        status: "applied",
        applyExitCode: 0,
        verification: [{
          command: "docker compose -f docker-compose.yml exec -T postgres psql -U coupon -d coupon -tAc \"SELECT COUNT(*) FROM tenant_hotel_brands;\"",
          exitCode: 0,
          stdout: "7\n",
          stderr: ""
        }]
      }
    });

    expect(summary).toEqual({
      title: "migrations/026_hotel_store_create_fields.sql",
      statusLabel: "applied / exit 0",
      tone: "good",
      detail: "SELECT COUNT(*) FROM tenant_hotel_brands; => 7",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
    });
  });

  it("marks failed seed evidence as bad", () => {
    const summary = buildSeedEvidenceSummary({
      id: "event-2",
      eventType: "coupon.seed_apply_failed",
      createdAt: "2026-05-17T09:23:00.000Z",
      payload: {
        migrationPath: "migrations/999_bad.sql",
        status: "applied",
        applyExitCode: 1,
        verification: []
      }
    });

    expect(summary.tone).toBe("bad");
    expect(summary.statusLabel).toBe("applied / exit 1");
  });
});
