import { describe, expect, it } from "vitest";

import { summarizeRunCycle } from "./dionysus-cycle.js";

describe("goal run-cycle summary", () => {
  it("surfaces blocked preflight and next owner", () => {
    expect(summarizeRunCycle({
      preflight: {
        status: "blocked",
        blockers: ["git worktree dirty: 2 changes"]
      },
      masterStep: {
        decision: {
          action: "blocked_dirty_worktree",
          reason: "target has uncommitted changes"
        }
      },
      milestoneDetection: { created: [] },
      milestones: []
    })).toMatchObject({
      status: "blocked",
      nextOwner: "Codex",
      nextActions: ["清理目标项目 Git 工作区后重新运行 goal run-cycle"]
    });
  });

  it("asks Codex to run E2E when milestone campaigns are ready", () => {
    expect(summarizeRunCycle({
      preflight: { status: "passed", blockers: [] },
      masterStep: { decision: { action: "ready_for_implementation" } },
      milestoneDetection: { created: [{ id: "m1" }] },
      milestones: [{ id: "m1", status: "e2e_running" }],
      campaigns: [{ id: "c1", milestoneId: "m1", status: "created" }]
    })).toMatchObject({
      status: "e2e_required",
      nextOwner: "Codex",
      nextActions: ["执行浏览器级 E2E 后提交 case-result 和 milestone verdict"]
    });
  });

  it("reports active progress when no blocker or milestone is waiting", () => {
    expect(summarizeRunCycle({
      preflight: { status: "passed", blockers: [] },
      masterStep: { decision: { action: "ready_for_implementation" } },
      milestoneDetection: { created: [] },
      milestones: []
    })).toMatchObject({
      status: "working",
      nextOwner: "Dionysus",
      nextActions: ["等待 Agent Runtime 或下一次 master-step 推进"]
    });
  });
});
