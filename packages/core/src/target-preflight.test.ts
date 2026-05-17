import { describe, expect, it } from "vitest";
import {
  buildTargetPreflight,
  findUnmanagedGitChanges,
  parseGitStatusPath,
  parseGitStatusPorcelain
} from "./target-preflight.js";

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

  it("extracts file paths from porcelain changes", () => {
    expect(parseGitStatusPath("?? apps/admin-api/internal/handler/real_db_smoke_test.go")).toBe(
      "apps/admin-api/internal/handler/real_db_smoke_test.go"
    );
    expect(parseGitStatusPath(" M apps/web/src/App.tsx")).toBe("apps/web/src/App.tsx");
    expect(parseGitStatusPath("R  old/path.ts -> new/path.ts")).toBe("new/path.ts");
  });

  it("separates managed integration changes from unknown dirty files", () => {
    expect(findUnmanagedGitChanges({
      changes: [
        "?? apps/admin-api/internal/handler/real_db_smoke_test.go",
        " M apps/admin-web/src/pages/hotels/panel.vue",
        " M apps/web/src/App.tsx"
      ],
      managedPaths: [
        "apps/admin-api/internal/handler/real_db_smoke_test.go",
        "apps/admin-web/src/pages/hotels/"
      ]
    })).toEqual([" M apps/web/src/App.tsx"]);
  });
});
