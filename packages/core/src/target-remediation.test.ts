import { describe, expect, it } from "vitest";
import { buildPreflightRemediation } from "./target-remediation.js";

describe("target preflight remediation", () => {
  it("drafts only missing SDD/TDD files", () => {
    const drafts = buildPreflightRemediation({
      goal: {
        title: "Coupon Trial",
        description: "试运行 Coupon",
        targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
      },
      gates: [
        {
          gateType: "plan",
          status: "blocked",
          required: ["docs/PLAN.md"],
          present: [],
          missing: ["docs/PLAN.md"]
        },
        {
          gateType: "spec",
          status: "passed",
          required: ["docs/specs"],
          present: ["docs/specs"],
          missing: []
        },
        {
          gateType: "test",
          status: "blocked",
          required: ["features_test"],
          present: [],
          missing: ["features_test"]
        }
      ]
    });

    expect(drafts.map((draft) => draft.path)).toEqual([
      "docs/PLAN.md",
      "features_test/preflight.feature.md"
    ]);
    expect(drafts[0].content).toContain("Coupon Trial");
    expect(drafts[1].content).toContain("Dionysus 执行 target preflight");
  });
});
