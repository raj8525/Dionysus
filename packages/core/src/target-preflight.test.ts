import { describe, expect, it } from "vitest";
import { buildTargetPreflight, parseGitStatusPorcelain } from "./target-preflight.js";

describe("target preflight", () => {
  it("parses clean and dirty git status", () => {
    expect(parseGitStatusPorcelain("")).toEqual({
      status: "passed",
      clean: true,
      changes: []
    });

    expect(parseGitStatusPorcelain(" M apps/web/src/App.tsx\n?? scratchpad.md\n")).toEqual({
      status: "blocked",
      clean: false,
      changes: [" M apps/web/src/App.tsx", "?? scratchpad.md"]
    });
  });

  it("combines git and SDD/TDD gates into blockers", () => {
    const preflight = buildTargetPreflight({
      git: parseGitStatusPorcelain(" M file.ts\n"),
      gates: [
        {
          gateType: "plan",
          status: "blocked",
          required: ["docs/PLAN.md"],
          present: [],
          missing: ["docs/PLAN.md"]
        },
        {
          gateType: "test",
          status: "passed",
          required: ["features_test"],
          present: ["features_test"],
          missing: []
        }
      ]
    });

    expect(preflight.status).toBe("blocked");
    expect(preflight.blockers).toEqual([
      "git worktree dirty: 1 changes",
      "plan gate blocked: missing docs/PLAN.md"
    ]);
  });
});
