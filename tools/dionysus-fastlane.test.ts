import { describe, expect, it } from "vitest";

import { buildFastLanePlan, parseFastLaneItem } from "./dionysus-fastlane.js";

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
});
