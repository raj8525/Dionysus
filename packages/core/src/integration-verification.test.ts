import { describe, expect, it } from "vitest";

import { inferIntegrationVerificationCommands, mergeIntegrationVerificationCommands } from "./integration-verification.js";

describe("integration verification command inference", () => {
  it("compiles admin-api handler tests for handler test patches", () => {
    expect(inferIntegrationVerificationCommands([
      "apps/admin-api/internal/handler/real_db_smoke_test.go"
    ])).toEqual(["go test -c ./apps/admin-api/internal/handler/"]);
  });

  it("falls back to full Go tests for non-handler Go changes", () => {
    expect(inferIntegrationVerificationCommands([
      "pkg/db/db.go"
    ])).toEqual(["go test ./... -count=1"]);
  });

  it("builds admin web for Vue or HTML UI changes", () => {
    expect(inferIntegrationVerificationCommands([
      "apps/admin-web/src/pages/tenants.vue"
    ])).toEqual(["pnpm --filter @coupon/admin-web build"]);
  });

  it("merges inferred and configured commands without duplicates", () => {
    expect(mergeIntegrationVerificationCommands({
      changedFiles: ["apps/admin-api/internal/handler/real_db_smoke_test.go"],
      configuredCommands: ["go test -c ./apps/admin-api/internal/handler/", "pnpm test"]
    })).toEqual(["go test -c ./apps/admin-api/internal/handler/", "pnpm test"]);
  });
});
