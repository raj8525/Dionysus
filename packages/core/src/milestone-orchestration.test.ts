import { describe, expect, it } from "vitest";
import {
  buildE2ECampaignDraft,
  buildMilestoneNotificationDraft,
  milestoneStatusForCodexVerdict,
  detectMilestoneCandidate
} from "./milestone-orchestration.js";

describe("milestone orchestration", () => {
  it("detects a milestone candidate only after integration and tests pass with user-facing changes", () => {
    expect(
      detectMilestoneCandidate({
        goalTitle: "Coupon",
        integrationStatus: "passed",
        patchStatus: "applied",
        changedFiles: ["apps/admin-web/src/pages/hotels.vue", "apps/admin-api/internal/handler/tenant.go"],
        testStatus: "passed",
        finalUserFeatureEvidence: ["admin/admin 登录后在酒店页面新增租户"],
        realDataPersistenceEvidence: ["刷新后新租户仍从 PostgreSQL 返回"]
      })
    ).toMatchObject({
      shouldCreate: true,
      name: "Coupon milestone: final-user fullstack module ready for Codex E2E"
    });

    expect(
      detectMilestoneCandidate({
        goalTitle: "Coupon",
        integrationStatus: "passed",
        patchStatus: "applied",
        changedFiles: ["apps/admin-api/internal/handler/real_db_smoke_test.go"],
        testStatus: "passed"
      })
    ).toMatchObject({
      shouldCreate: false,
      candidateReason: "Milestone gate is not satisfied: missing user-facing frontend changes."
    });

    expect(
      detectMilestoneCandidate({
        goalTitle: "Coupon",
        integrationStatus: "passed",
        patchStatus: "applied",
        changedFiles: ["apps/admin-web/src/pages/hotels.vue"],
        testStatus: "passed",
        finalUserFeatureEvidence: ["用户可以看到页面"],
        realDataPersistenceEvidence: ["刷新后数据仍存在"]
      })
    ).toMatchObject({
      shouldCreate: false,
      candidateReason: "Milestone gate is not satisfied: missing backend/API/database changes."
    });

    expect(
      detectMilestoneCandidate({
        goalTitle: "Coupon",
        integrationStatus: "passed",
        patchStatus: "applied",
        changedFiles: ["apps/admin-web/src/pages/hotels.vue", "apps/admin-api/internal/handler/tenant.go"],
        testStatus: "passed"
      })
    ).toMatchObject({
      shouldCreate: false,
      candidateReason: "Milestone gate is not satisfied: missing final-user browser workflow evidence."
    });

    expect(
      detectMilestoneCandidate({
        goalTitle: "Coupon",
        integrationStatus: "queued",
        patchStatus: "applied",
        changedFiles: ["apps/admin-web/src/pages/hotels.vue"],
        testStatus: "passed"
      }).shouldCreate
    ).toBe(false);
  });

  it("builds browser E2E cases that include smoke, happy path, negative path, and refresh persistence", () => {
    const campaign = buildE2ECampaignDraft({
      milestoneName: "Tenant create",
      targetUrl: "http://localhost:5173",
      acceptance: [
        "admin/admin 登录后可以新增租户",
        "重复 slug 返回稳定错误码"
      ]
    });

    expect(campaign.cases.map((testCase) => testCase.caseType)).toEqual([
      "smoke",
      "happy_path",
      "negative_path",
      "persistence"
    ]);
    expect(campaign.cases[1].steps.length).toBeGreaterThan(2);
    expect(campaign.cases[2].expectedResult).toContain("错误");
  });

  it("builds a concise notification draft for a passed milestone", () => {
    const draft = buildMilestoneNotificationDraft({
      milestoneName: "Tenant create",
      summary: "新增租户闭环已通过",
      targetUrl: "http://localhost:5173",
      verificationCommands: ["pnpm test", "pnpm --filter @coupon/admin-web build"],
      residualRisks: ["尚未接入真实短信验证码"]
    });

    expect(draft.title).toBe("[Dionysus] Milestone passed: Tenant create");
    expect(draft.body).toContain("新增租户闭环已通过");
    expect(draft.body).toContain("如何验收");
    expect(draft.body).toContain("尚未接入真实短信验证码");
  });

  it("does not allow Codex to mark a milestone passed before E2E is running", () => {
    expect(() => milestoneStatusForCodexVerdict("candidate", "passed")).toThrow(/Invalid milestone transition/);
    expect(() => milestoneStatusForCodexVerdict("e2e_required", "passed")).toThrow(/Invalid milestone transition/);
    expect(milestoneStatusForCodexVerdict("e2e_running", "passed")).toBe("passed");
    expect(milestoneStatusForCodexVerdict("e2e_required", "blocked")).toBe("e2e_blocked");
  });
});
