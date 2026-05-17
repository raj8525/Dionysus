import { describe, expect, it } from "vitest";
import { evaluateCouponDataFirstEnqueueGate } from "./coupon-data-first-gate.js";

describe("Coupon data-first enqueue gate", () => {
  it("allows ordinary tasks", () => {
    expect(evaluateCouponDataFirstEnqueueGate({
      task: { id: "w1", title: "FastLane Worker 1: 库存修复", status: "created" },
      goalTasks: []
    })).toEqual({ allowed: true });
  });

  it("allows the data foundation worker itself", () => {
    expect(evaluateCouponDataFirstEnqueueGate({
      task: { id: "w1", title: "FastLane Worker 1: 租户管理 数据基座", status: "created" },
      goalTasks: []
    })).toEqual({ allowed: true });
  });

  it("blocks read API and Vue workers until the data foundation is done", () => {
    const goalTasks = [
      { id: "w1", title: "FastLane Worker 1: 租户管理 数据基座", status: "created" },
      { id: "w2", title: "FastLane Worker 2: 租户管理 只读 API", status: "created" },
      { id: "w3", title: "FastLane Worker 3: 租户管理 Vue 只读首页", status: "created" }
    ];

    expect(evaluateCouponDataFirstEnqueueGate({
      task: goalTasks[1],
      goalTasks
    })).toEqual({
      allowed: false,
      error: "COUPON_DATA_FIRST_GATE_BLOCKED",
      reason: "Coupon 数据先行门禁阻止提前入队：数据基座 Worker 未完成，不能启动只读 API 或 Vue 只读首页。"
    });
    expect(evaluateCouponDataFirstEnqueueGate({
      task: goalTasks[2],
      goalTasks
    }).allowed).toBe(false);
  });

  it("allows read API and Vue workers after the data foundation is done", () => {
    const goalTasks = [
      { id: "w1", title: "FastLane Worker 1: 租户管理 数据基座", status: "done" },
      { id: "w2", title: "FastLane Worker 2: 租户管理 只读 API", status: "created" },
      { id: "w3", title: "FastLane Worker 3: 租户管理 Vue 只读首页", status: "created" }
    ];

    expect(evaluateCouponDataFirstEnqueueGate({
      task: goalTasks[1],
      goalTasks
    })).toEqual({ allowed: true });
    expect(evaluateCouponDataFirstEnqueueGate({
      task: goalTasks[2],
      goalTasks
    })).toEqual({ allowed: true });
  });
});
