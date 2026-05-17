import { describe, expect, it } from "vitest";

import { buildFastLanePlan, buildFastLaneStatus, parseFastLaneItem } from "./dionysus-fastlane.js";

describe("dionysus fast lane planner", () => {
  it("parses title and description from CLI item syntax", () => {
    expect(parseFastLaneItem("库存流水后端::实现查询 API 和测试")).toEqual({
      title: "库存流水后端",
      description: "实现查询 API 和测试"
    });
    expect(parseFastLaneItem("库存流水前端")).toEqual({
      title: "库存流水前端",
      description: "库存流水前端"
    });
  });

  it("builds queued worker tasks and gated reviewer tasks", () => {
    const plan = buildFastLanePlan({
      title: "库存流水查询闭环",
      description: "让最终用户在库存页看到真实库存流水",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      workers: [
        parseFastLaneItem("后端 API::补 GET /api/admin/inventory/transactions"),
        parseFastLaneItem("前端展示::在 inventory.vue 展示真实流水")
      ]
    });

    expect(plan.goal).toEqual({
      title: "库存流水查询闭环",
      description: "让最终用户在库存页看到真实库存流水",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
    });
    expect(plan.tasks.map((task) => [task.lane, task.priority, task.queue])).toEqual([
      ["worker", 20, true],
      ["worker", 21, true],
      ["reviewer", 80, false]
    ]);
    expect(plan.tasks[0].description).toContain("Dionysus isolated workspace");
    expect(plan.tasks[2].description).toContain("Below 90 is BLOCKED");
    expect(plan.nextCommands.join("\n")).toContain("agent usage");
  });

  it("can explicitly queue reviewers for already integrated work", () => {
    const plan = buildFastLanePlan({
      title: "评审已集成 patch",
      description: "已有 Worker 产物，需要 reviewer 直接审查",
      targetRoot: "/tmp/project",
      workers: [parseFastLaneItem("补测试::补红绿测试")],
      reviewers: [parseFastLaneItem("安全评审::检查租户隔离")],
      queueReviewers: true
    });

    expect(plan.tasks.filter((task) => task.lane === "reviewer")).toHaveLength(1);
    expect(plan.tasks.find((task) => task.lane === "reviewer")?.queue).toBe(true);
  });

  it("rejects empty worker sets", () => {
    expect(() => buildFastLanePlan({
      title: "目标",
      description: "描述",
      targetRoot: "/tmp/project",
      workers: []
    })).toThrow("at least one --worker");
  });

  it("tells Codex to review worker tasks before starting reviewers", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-1", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 后端", "needs_review"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "created")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("worker_review");
    expect(status.nextAction).toBe("先评审 Worker 产物，approve 后才能启动 ReviewerCLI。");
    expect(status.nextCommands).toContain("pnpm dionysus task review --task-id w1 --verdict approve --reason \"Worker output accepted by Codex\"");
  });

  it("tells Codex to enqueue reviewer tasks when workers are done", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-2", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 后端", "done"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "created")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("ready_for_reviewer");
    expect(status.nextAction).toBe("Worker 已完成，启动 ReviewerCLI 做 90 分质量门禁。");
    expect(status.nextCommands).toEqual(["pnpm dionysus task enqueue --task-id r1"]);
  });

  it("requires a reviewer approval score in the suggested handoff command", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-review", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 后端", "done"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "needs_review")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("reviewer_review");
    expect(status.nextCommands).toContain("pnpm dionysus run logs --run-id <run-id-for-task-r1>");
    expect(status.nextCommands).toContain("pnpm dionysus task review --task-id r1 --verdict approve --score 90 --reason \"Reviewer gate accepted by Codex\"");
  });

  it("prioritizes Codex outbox blockers over normal fast lane flow", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-3", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 后端", "done"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "created")
      ],
      integrations: [],
      pendingCodexOutbox: [{ id: "event-1", title: "blocker" }]
    });

    expect(status.phase).toBe("codex_outbox");
    expect(status.nextCommands).toEqual(["pnpm dionysus codex heartbeat --limit 5"]);
  });

  it("reports terminal fast lane goals without suggesting more work", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-4", status: "cancelled" },
      tasks: [
        task("w1", "FastLane Worker 1: 后端", "cancelled"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "cancelled")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("closed");
    expect(status.nextAction).toBe("fast lane goal 已结束，无需继续调度。");
    expect(status.nextCommands).toEqual([]);
  });
});

function task(id: string, title: string, status: string): Record<string, unknown> {
  return {
    id,
    title,
    status,
    role_required: "worker",
    priority: title.includes("Reviewer") ? 80 : 20
  };
}
