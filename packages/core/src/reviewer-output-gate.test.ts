import { describe, expect, it } from "vitest";

import {
  evaluateFastLaneReviewerOutputGate,
  evaluateReportOnlyReviewerOutputGate
} from "./reviewer-output-gate.js";

const reportOnlyDescription = [
  "Report-only mode: review Worker reports, not integrated patches.",
  "Required response format:",
  "Verdict: PASS|BLOCKED",
  "Score: <0-100>",
  "Evidence reviewed: <files/tests/logs/commands cited by Worker>",
  "Coverage gaps: <concrete list or none>",
  "Required fixes: <concrete list or none>",
  "Codex handoff: <what Codex must decide or verify next>"
].join("\n");

describe("evaluateFastLaneReviewerOutputGate", () => {
  it("does not gate non FastLane Reviewer tasks", () => {
    expect(evaluateFastLaneReviewerOutputGate({
      taskTitle: "FastLane Worker 1: 功能地图",
      taskDescription: reportOnlyDescription,
      output: "需要我继续做什么？"
    })).toEqual({ allowed: true });
  });

  it("blocks patch-mode reviewers that stop before structured product judgment", () => {
    expect(evaluateFastLaneReviewerOutputGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      taskDescription: "Review Worker patch and tests.",
      output: "需要我继续做什么？"
    })).toEqual({
      allowed: false,
      reason: "FastLane Reviewer output is missing required fields: Verdict, Score, Evidence, Product/UX assessment, Required fixes, Codex handoff.",
      missingFields: ["Verdict", "Score", "Evidence", "Product/UX assessment", "Required fixes", "Codex handoff"]
    });
  });

  it("accepts complete patch-mode reviewer output with product and UX assessment", () => {
    expect(evaluateFastLaneReviewerOutputGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      taskDescription: "Review Worker patch and tests.",
      output: [
        "Verdict: PASS",
        "Score: 91",
        "Evidence: tests/e2e/identity-overview-layout.spec.js, screenshot /tmp/identity.png",
        "Product/UX assessment: 页内上下文切换保留，明确 CTA 进入子页面，没有机械复刻模板。",
        "Required fixes: none",
        "Codex handoff: run browser E2E and decide release"
      ].join("\n")
    })).toEqual({
      allowed: true,
      verdict: "PASS",
      score: 91
    });
  });

  it("blocks report-only reviewers that stop before a structured verdict", () => {
    expect(evaluateFastLaneReviewerOutputGate({
      taskTitle: "FastLane Reviewer 2: D1产品语义验收Reviewer",
      taskDescription: reportOnlyDescription,
      output: "根据后台任务结果，梳理如下：\n\n需要我继续做什么？"
    })).toEqual({
      allowed: false,
      reason: "Report-only FastLane Reviewer output is missing required fields: Verdict, Score, Evidence reviewed, Coverage gaps, Required fixes, Codex handoff.",
      missingFields: ["Verdict", "Score", "Evidence reviewed", "Coverage gaps", "Required fixes", "Codex handoff"]
    });
  });

  it("blocks report-only reviewers with invalid verdict or score", () => {
    expect(evaluateFastLaneReviewerOutputGate({
      taskTitle: "FastLane Reviewer 1: 产品验收Reviewer",
      taskDescription: reportOnlyDescription,
      output: [
        "Verdict: MAYBE",
        "Score: ninety",
        "Evidence reviewed: worker logs",
        "Coverage gaps: missing E2E",
        "Required fixes: rerun Worker",
        "Codex handoff: decide next target"
      ].join("\n")
    })).toEqual({
      allowed: false,
      reason: "Report-only FastLane Reviewer output has invalid Verdict or Score.",
      missingFields: []
    });
  });

  it("accepts complete PASS or BLOCKED report-only reviewer output", () => {
    expect(evaluateFastLaneReviewerOutputGate({
      taskTitle: "FastLane Reviewer 1: 产品验收Reviewer",
      taskDescription: reportOnlyDescription,
      output: [
        "Verdict: BLOCKED",
        "Score: 82",
        "Evidence reviewed: Worker run abc, tests/e2e/foo.spec.js",
        "Coverage gaps: missing impersonation E2E",
        "Required fixes: create a focused Worker task",
        "Codex handoff: reject this reviewer gate and start implementation"
      ].join("\n")
    })).toEqual({
      allowed: true,
      verdict: "BLOCKED",
      score: 82
    });
  });

  it("keeps the legacy report-only gate scoped to report-only reviewers", () => {
    expect(evaluateReportOnlyReviewerOutputGate({
      taskTitle: "FastLane Reviewer 1: 质量门禁",
      taskDescription: "Review Worker patch and tests.",
      output: "需要我继续做什么？"
    })).toEqual({ allowed: true });
  });
});
