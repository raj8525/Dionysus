import { describe, expect, it } from "vitest";

import {
  buildCouponDataFirstFastLanePlan,
  buildFastLanePlan,
  buildFastLaneStatus,
  extractFastLaneAdvanceTaskIds,
  isFastLaneReviewerTask,
  isFastLaneWorkerTask,
  parseFastLaneItem
} from "./dionysus-fastlane.js";

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

  it("classifies fast lane workers and reviewers by title, not created status", () => {
    expect(isFastLaneWorkerTask({
      title: "FastLane Worker 2: 租户管理 只读 API",
      status: "created"
    })).toBe(true);
    expect(isFastLaneReviewerTask({
      title: "FastLane Worker 2: 租户管理 只读 API",
      status: "created"
    })).toBe(false);
    expect(isFastLaneReviewerTask({
      title: "FastLane Reviewer 1: 租户管理 ReviewerCLI 90 分质量门禁",
      status: "created"
    })).toBe(true);
  });

  it("rejects empty worker sets", () => {
    expect(() => buildFastLanePlan({
      title: "目标",
      description: "描述",
      targetRoot: "/tmp/project",
      workers: []
    })).toThrow("at least one --worker");
  });

  it("starts reviewers once every worker output is reviewable", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-1", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 后端", "needs_review"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "created")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("ready_for_reviewer");
    expect(status.nextAction).toBe("Worker 产物已可审查，启动 ReviewerCLI 做 90 分质量门禁。");
    expect(status.nextCommands).toEqual(["pnpm dionysus task enqueue --task-id r1"]);
    expect(extractFastLaneAdvanceTaskIds(status)).toEqual(["r1"]);
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
    expect(status.nextAction).toBe("Worker 产物已可审查，启动 ReviewerCLI 做 90 分质量门禁。");
    expect(status.nextCommands).toEqual(["pnpm dionysus task enqueue --task-id r1"]);
  });

  it("ignores cancelled superseded workers when deciding reviewer readiness", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-2b", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 数据确认", "done"),
        task("w2", "FastLane Worker 2: 后端 API", "done"),
        task("w3", "FastLane Worker 3: 前端 Vue 初版", "cancelled"),
        task("w4", "FastLane Worker 4: 前端 Vue 重跑", "done"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "created")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("ready_for_reviewer");
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

  it("builds a Coupon data-first module plan before write-path work", () => {
    const plan = buildCouponDataFirstFastLanePlan({
      module: "租户管理",
      title: "租户管理只读闭环",
      description: "让最终用户在租户管理页看到数据库中的完整集团租户事实数据",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      pagePath: "apps/admin-web/src/pages/tenants.vue",
      apiPath: "/api/admin/tenants"
    });

    expect(plan.goal.title).toBe("租户管理只读闭环");
    expect(plan.tasks.map((task) => task.lane)).toEqual(["worker", "worker", "worker", "reviewer"]);
    expect(plan.tasks.map((task) => task.queue)).toEqual([true, false, false, false]);
    expect(plan.tasks[0].description).toContain("先补数据库表结构和完整虚拟数据");
    expect(plan.tasks[0].description).toContain("migrations/");
    expect(plan.tasks[1].description).toContain("只读 API");
    expect(plan.tasks[1].description).toContain("/api/admin/tenants");
    expect(plan.tasks[2].description).toContain("Vue 页面必须读取真实接口数据");
    expect(plan.tasks[2].description).toContain("禁止 v-html");
    expect(plan.tasks[2].description).toContain("tenants.vue 是成熟的集团租户管理页");
    expect(plan.tasks[3].description).toContain("90 分质量门禁");
    expect(plan.tasks[3].description).toContain("写路径不得进入本轮范围");
    expect(plan.nextCommands.join("\n")).toContain("fastlane status");
  });

  it("can build a Coupon data-only module plan without API or Vue workers", () => {
    const plan = buildCouponDataFirstFastLanePlan({
      module: "酒店管理",
      title: "酒店模块测试数据基座",
      description: "只补充酒店模块 PostgreSQL 测试数据",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      pagePath: "apps/admin-web/src/pages/hotels.vue",
      apiPath: "/api/admin/hotels",
      dataOnly: true
    });

    expect(plan.tasks.map((task) => task.title)).toEqual([
      "FastLane Worker 1: 酒店管理 数据基座",
      "FastLane Reviewer 1: 酒店管理 数据基座 ReviewerCLI 90 分质量门禁"
    ]);
    expect(plan.tasks.map((task) => task.queue)).toEqual([true, false]);
    expect(plan.tasks[0].description).toContain("不能把 Dionysus 隔离 workspace 路径写入长期文档");
    expect(plan.tasks[0].description).toContain("docker compose -f docker-compose.yml exec -T postgres psql");
    expect(plan.nextCommands.join("\n")).toContain("data-only 模式不会创建 API/Vue Worker");
  });

  it("builds a Coupon hotel-store module plan without tenant-page semantics", () => {
    const plan = buildCouponDataFirstFastLanePlan({
      module: "酒店管理",
      title: "酒店门店只读闭环",
      description: "让最终用户在酒店管理页看到数据库中的门店和部门事实数据",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
      pagePath: "apps/admin-web/src/pages/hotels.vue",
      apiPath: "/api/admin/hotels",
      htmlTemplatePath: "apps/admin-web/html/hotels.html"
    });

    expect(plan.tasks[1].description).toContain("/api/admin/hotels");
    expect(plan.tasks[2].description).toContain("hotels.vue 当前管理真实酒店门店和部门");
    expect(plan.tasks[2].description).toContain("不得退回集团租户列表语义");
    expect(plan.tasks[2].description).not.toContain("左侧租户点击切换右侧详情");
  });

  it("tells Codex to enqueue read-path workers only after the data foundation worker is done", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-data-first", status: "fast_lane" },
      tasks: [
        task("w1", "FastLane Worker 1: 租户管理 数据基座", "done"),
        task("w2", "FastLane Worker 2: 租户管理 只读 API", "created"),
        task("w3", "FastLane Worker 3: 租户管理 Vue 只读首页", "created"),
        task("r1", "FastLane Reviewer 1: 租户管理 ReviewerCLI 90 分质量门禁", "created")
      ],
      integrations: [],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("ready_for_data_followups");
    expect(status.nextAction).toContain("数据基座已完成");
    expect(status.nextCommands).toEqual([
      "pnpm dionysus task enqueue --task-id w2",
      "pnpm dionysus task enqueue --task-id w3"
    ]);
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

  it("does not expose stale worker or integration counts as actionable work for closed goals", () => {
    const status = buildFastLaneStatus({
      goal: { id: "goal-released", status: "done" },
      tasks: [
        task("w1", "FastLane Worker 1: 数据基座", "needs_review"),
        task("w2", "FastLane Worker 2: 只读 API", "created"),
        task("r1", "FastLane Reviewer 1: 质量门禁", "created")
      ],
      integrations: [
        { id: "iq1", status: "failed" },
        { id: "iq2", status: "queued" }
      ],
      pendingCodexOutbox: []
    });

    expect(status.phase).toBe("closed");
    expect(status.counts.workers).toEqual({});
    expect(status.counts.reviewers).toEqual({});
    expect(status.counts.integrations).toEqual({});
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
