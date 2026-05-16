import { describe, expect, it } from "vitest";
import {
  buildE2ECampaignDraft,
  buildMilestoneNotificationDraft,
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
        testStatus: "passed"
      })
    ).toMatchObject({
      shouldCreate: true,
      name: "Coupon milestone: 2 changed files ready for Codex E2E"
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
});
