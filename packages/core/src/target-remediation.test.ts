import { describe, expect, it } from "vitest";
import { buildAddFilesPatch, buildPreflightRemediation } from "./target-remediation.js";

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

  it("builds a git-apply compatible patch for new files", () => {
    const patch = buildAddFilesPatch([
      {
        path: "docs/PLAN.md",
        content: "# Plan\n\n- item"
      }
    ]);

    expect(patch).toContain("diff --git a/docs/PLAN.md b/docs/PLAN.md");
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+++ b/docs/PLAN.md");
    expect(patch).toContain("+# Plan");
    expect(patch).toContain("+- item");
  });

  it("rejects unsafe paths", () => {
    expect(() => buildAddFilesPatch([{ path: "../PLAN.md", content: "bad" }])).toThrow("unsafe remediation path");
    expect(() => buildAddFilesPatch([{ path: "/tmp/PLAN.md", content: "bad" }])).toThrow("unsafe remediation path");
  });
});
