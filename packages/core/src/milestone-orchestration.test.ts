import { describe, expect, it } from "vitest";
import {
  buildE2ECampaignDraft,
  buildMilestoneNotificationDraft,
  evaluateMilestoneNotificationGate,
  evaluateMilestoneVerdictGate,
  milestoneStatusForE2ECampaignCreation,
  milestoneStatusForE2ERequest,
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

  it("allows milestone notifications only after the milestone has passed", () => {
    expect(evaluateMilestoneNotificationGate("passed")).toEqual({ allowed: true });
    expect(evaluateMilestoneNotificationGate("e2e_running")).toEqual({
      allowed: false,
      reason: "Milestone notification requires milestone status passed; current status is e2e_running."
    });
    expect(evaluateMilestoneNotificationGate("e2e_failed")).toEqual({
      allowed: false,
      reason: "Milestone notification requires milestone status passed; current status is e2e_failed."
    });
  });

  it("does not allow Codex to mark a milestone passed before E2E is running", () => {
    expect(() => milestoneStatusForCodexVerdict("candidate", "passed")).toThrow(/Invalid milestone transition/);
    expect(() => milestoneStatusForCodexVerdict("e2e_required", "passed")).toThrow(/Invalid milestone transition/);
    expect(milestoneStatusForCodexVerdict("e2e_running", "passed")).toBe("passed");
    expect(milestoneStatusForCodexVerdict("e2e_required", "blocked")).toBe("e2e_blocked");
  });

  it("requires legal milestone transitions before requesting E2E or creating campaigns", () => {
    expect(milestoneStatusForE2ERequest("candidate")).toBe("e2e_required");
    expect(() => milestoneStatusForE2ERequest("passed")).toThrow(/Invalid milestone transition/);
    expect(() => milestoneStatusForE2ERequest("e2e_running")).toThrow(/Invalid milestone transition/);

    expect(milestoneStatusForE2ECampaignCreation("e2e_required")).toBe("e2e_running");
    expect(() => milestoneStatusForE2ECampaignCreation("candidate")).toThrow(/Invalid milestone transition/);
    expect(() => milestoneStatusForE2ECampaignCreation("passed")).toThrow(/Invalid milestone transition/);
  });

  it("blocks a passed milestone verdict until every E2E campaign has passed", () => {
    expect(evaluateMilestoneVerdictGate({
      currentStatus: "e2e_running",
      verdict: "passed",
      e2eCampaigns: []
    })).toEqual({
      allowed: false,
      reason: "Milestone passed verdict requires at least one E2E campaign."
    });

    expect(evaluateMilestoneVerdictGate({
      currentStatus: "e2e_running",
      verdict: "passed",
      e2eCampaigns: [
        { status: "passed", caseResultModes: ["strict"] },
        { status: "blocked", caseResultModes: ["strict"] }
      ]
    })).toEqual({
      allowed: false,
      reason: "Milestone passed verdict requires every E2E campaign to be passed; current statuses: passed, blocked."
    });

    expect(evaluateMilestoneVerdictGate({
      currentStatus: "e2e_running",
      verdict: "passed",
      e2eCampaigns: [
        { status: "passed", caseResultModes: ["strict", "strict"] }
      ]
    })).toEqual({
      allowed: true,
      nextStatus: "passed"
    });
  });

  it("blocks a passed milestone verdict if any passed campaign used render-only evidence", () => {
    expect(evaluateMilestoneVerdictGate({
      currentStatus: "e2e_running",
      verdict: "passed",
      e2eCampaigns: [
        { status: "passed", caseResultModes: ["strict", "render-only"] }
      ]
    })).toEqual({
      allowed: false,
      reason: "Milestone passed verdict requires every E2E case result to use strict mode evidence; current modes: strict, render-only."
    });
  });
});
