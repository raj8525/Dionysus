import { describe, expect, it } from "vitest";

import { buildReleaseRecordRequest } from "./dionysus-release-record.js";

describe("buildReleaseRecordRequest", () => {
  it("builds a release record payload from Codex CLI flags", () => {
    const request = buildReleaseRecordRequest([
      "--goal-id", "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
      "--target-root", "/Volumes/MacMiniSSD/code/Coupon",
      "--branch", "main",
      "--commit-sha", "fabbb07",
      "--status", "passed",
      "--pushed", "true",
      "--changed-file", "apps/admin-api/internal/handler/real_db_smoke_test.go",
      "--changed-file", "docs/qa/2026-05-17-real-db-smoke.md",
      "--verification-json", "[{\"command\":\"go test ./apps/admin-api/internal/handler/ -run TestRealDB_ -count=1\",\"status\":\"passed\"}]",
      "--summary", "真实数据库 smoke 测试已提交并推送"
    ]);

    expect(request).toEqual({
      goalId: "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      branch: "main",
      commitSha: "fabbb07",
      status: "passed",
      pushed: true,
      changedFiles: [
        "apps/admin-api/internal/handler/real_db_smoke_test.go",
        "docs/qa/2026-05-17-real-db-smoke.md"
      ],
      verification: [
        {
          command: "go test ./apps/admin-api/internal/handler/ -run TestRealDB_ -count=1",
          status: "passed"
        }
      ],
      summary: "真实数据库 smoke 测试已提交并推送"
    });
  });

  it("rejects invalid release status", () => {
    expect(() => buildReleaseRecordRequest([
      "--goal-id", "goal",
      "--target-root", "/repo",
      "--branch", "main",
      "--commit-sha", "abc",
      "--status", "ready"
    ])).toThrow("--status must be one of passed, failed, blocked");
  });

  it("rejects passed pushed release records without concrete evidence", () => {
    expect(() => buildReleaseRecordRequest([
      "--goal-id", "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
      "--target-root", "/repo",
      "--branch", "main",
      "--commit-sha", "abc",
      "--status", "passed",
      "--pushed", "true"
    ])).toThrow("passed pushed release requires changedFiles, at least one passed verification command, and a non-empty summary");
  });

  it("rejects failed or blocked release records without a summary", () => {
    expect(() => buildReleaseRecordRequest([
      "--goal-id", "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
      "--target-root", "/repo",
      "--branch", "main",
      "--commit-sha", "abc",
      "--status", "blocked"
    ])).toThrow("release record requires a non-empty summary");
  });
});
